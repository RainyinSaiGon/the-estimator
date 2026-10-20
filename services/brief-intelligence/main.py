import asyncio
import json
import logging
import math
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath

import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from agent_runtime import run_agent_analysis
from document_ingest import MAX_UPLOAD_BYTES, extract_document
from service_auth import ServiceAuthConfigurationError, analysis_service_auth, configured_service_token_keys, service_token_auth_status
from workflow_intelligence import router as workflow_router


def _request_timeout_seconds() -> float:
    raw = os.environ.get("REQUEST_TIMEOUT_SECONDS", "8")
    try:
        value = float(raw)
    except ValueError as error:
        raise RuntimeError("REQUEST_TIMEOUT_SECONDS must be between 1 and 45.") from error
    if not math.isfinite(value) or not 1 <= value <= 45:
        raise RuntimeError("REQUEST_TIMEOUT_SECONDS must be between 1 and 45.")
    return value


REQUEST_TIMEOUT_SECONDS = _request_timeout_seconds()
REQUEST_ID_PATTERN = re.compile(
    r"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$",
    re.IGNORECASE,
)
ANALYSIS_SERVICE_SCOPES = {
    "/v1/workflow/analyze": "workflow:analyze",
    "/v1/workflow/extract": "workflow:extract",
    "/v1/workflow/fetch": "workflow:fetch",
    "/v1/briefs/analyze": "briefs:analyze",
    "/v1/briefs/analyze-document": "briefs:analyze-document",
}


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "severity": record.levelname.lower(),
            "service": "brief-intelligence",
            "event": record.getMessage(),
        }
        for name in ("request_id", "method", "path", "status", "duration_ms"):
            if hasattr(record, name):
                event[name] = getattr(record, name)
        return json.dumps(event, separators=(",", ":"), ensure_ascii=False)


def configure_json_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True


class OperationsMiddleware:
    def __init__(self, app):
        self.app = app
        self.logger = logging.getLogger("brief-intelligence.http")

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        candidate = headers.get(b"x-request-id", b"").decode("ascii", errors="ignore")
        request_id = candidate if REQUEST_ID_PATTERN.fullmatch(candidate) else uuid.uuid4().hex
        method = scope.get("method", "")
        path = scope.get("path", "/")
        started_at = time.perf_counter()
        status = 500
        response_started = False

        async def send_with_request_id(message):
            nonlocal status, response_started
            if message.get("type") == "http.response.start":
                response_started = True
                status = message["status"]
                response_headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"x-request-id"
                ]
                response_headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": response_headers}
            await send(message)

        try:
            required_scope = ANALYSIS_SERVICE_SCOPES.get(path)
            auth_status = None
            if required_scope:
                authorization = headers.get(b"authorization", b"").decode("latin-1")
                auth_status = service_token_auth_status(authorization, required_scope)
            if auth_status is not None:
                detail = "Internal service authentication is not configured." if auth_status == 503 else "A valid internal service credential is required."
                await send_with_request_id({
                    "type": "http.response.start",
                    "status": auth_status,
                    "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")],
                })
                await send_with_request_id({
                    "type": "http.response.body",
                    "body": json.dumps({"detail": detail}, separators=(",", ":")).encode("utf-8"),
                    "more_body": False,
                })
            else:
                async with asyncio.timeout(REQUEST_TIMEOUT_SECONDS):
                    await self.app(scope, receive, send_with_request_id)
        except TimeoutError:
            status = 504
            if not response_started:
                await send_with_request_id({
                    "type": "http.response.start",
                    "status": 504,
                    "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")],
                })
                await send_with_request_id({
                    "type": "http.response.body",
                    "body": b'{"detail":"Service request timed out."}',
                    "more_body": False,
                })
        finally:
            severity = logging.ERROR if status >= 500 else logging.INFO
            self.logger.log(
                severity,
                "http_request",
                extra={
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
                },
            )

app = FastAPI(title="The Estimator Brief Intelligence", version="0.1.0")
app.add_middleware(OperationsMiddleware)
app.include_router(workflow_router)


class AnalyzeRequest(BaseModel):
    brief: str = Field(min_length=30, max_length=20_000)
    parser: str = "sample"
    capabilities: list[str] = Field(default_factory=list, max_length=30)


def validate_capabilities(values: list[str]) -> list[str]:
    if len(values) > 30 or any(not isinstance(item, str) or not item.strip() or len(item.strip()) > 160 for item in values):
        raise HTTPException(status_code=422, detail="Provide up to 30 non-empty team capabilities of 160 characters or fewer.")
    return [item.strip() for item in values]


def analysis_error_status(message: str) -> int:
    normalized = message.lower()
    if "timed out" in normalized or "timeout" in normalized:
        return 504
    if any(term in normalized for term in ("not configured", "key was rejected", "permissions", "usage limit", "quota", "rate-limited", "could not be reached")):
        return 503
    return 502


def sample_scope(brief: str, team_capabilities: list[str] | None = None) -> dict:
    lines = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", brief) if part.strip()]

    def evidence(pattern: str) -> str:
        return next((line for line in lines if re.search(pattern, line, re.IGNORECASE)), "")

    migration = evidence(r"\b(csv|migrat\w*|import\w*|historical|legacy)\b")
    sync = evidence(r"\b(sync\w*|nightly|every night|integrat\w*|connect\w*)\b")
    dedup = evidence(r"\b(duplicat\w*|dedup\w*|reconcil\w*)\b")
    integration = bool(migration or sync or re.search(r"\b(api|crm|database|data|system|software|website|application|automate|workflow|report|dashboard|design|develop|build|launch|configure|analy[sz]e|research|audit|train|support|deploy)\b", brief, re.IGNORECASE))

    answers = {"direction": "unknown", "api": "unknown", "quality": "unknown", "volume": "unknown", "mapping": "unknown"}
    if re.search(r"two.way|bi.?directional|both directions", brief, re.IGNORECASE):
        answers["direction"] = "two-way"
    elif re.search(r"one.way|unidirectional", brief, re.IGNORECASE):
        answers["direction"] = "one-way"
    if re.search(r"duplicat|missing (company|fields|values)|incomplete|dirty", brief, re.IGNORECASE):
        answers["quality"] = "mixed"
    match = re.search(r"\b(\d[\d,]*)\s+(?:existing\s+)?(?:contacts|customers|records|rows)\b", brief, re.IGNORECASE)
    if match:
        count = int(match.group(1).replace(",", ""))
        answers["volume"] = "small" if count < 10_000 else "medium" if count <= 100_000 else "large"

    requirements = []
    if migration or sync:
        requirements.append({"id": "mapping", "title": "Map records to destination fields", "evidence": migration or sync})
        if migration:
            requirements.append({"id": "import", "title": "Import historical records", "evidence": migration})
        if sync:
            requirements.append({"id": "sync", "title": "Connect systems and synchronize updates", "evidence": sync})
        if dedup:
            requirements.append({"id": "deduplication", "title": "Detect duplicates and reconcile records", "evidence": dedup})
    else:
        action_pattern = r"\b(build|create|design|develop|implement|automate|configure|migrate|analy[sz]e|research|audit|integrate|launch|deploy|train|support|improve|review|deliver|prepare|produce|connect|update)\b"
        for index, line in enumerate(lines):
            if re.search(action_pattern, line, re.IGNORECASE):
                requirements.append({"id": f"work-{index + 1}", "title": line[:180], "evidence": line, "complexity": "complex" if re.search(r"\b(multiple|custom|enterprise|high-volume|regulated|security|complex)\b", line, re.IGNORECASE) else "moderate"})
        requirements = requirements[:20]
    if not requirements:
        first = lines[0] if lines else brief[:300]
        requirements.append({"id": "work-1", "title": "Clarify the requested outcome", "evidence": first, "complexity": "moderate"})
    for requirement in requirements:
        requirement["evidenceStatus"] = "verified"

    gaps = []
    for key, pattern, question, reason in [
        ("outcome", r"\b(success|acceptance|outcome|done when|measure|kpi)\b", "What outcome or acceptance criteria will define success?", "No measurable success criteria were found in the request."),
        ("users", r"\b(users|customers|teams|records|rows|volume|traffic)\b", "Who will use this and at what scale?", "User groups and scale are unclear."),
        ("dependencies", r"\b(api|access|documentation|credentials|vendor|dependency|environment)\b", "Which systems, access, and dependencies will be available?", "Required access or dependency details are not stated."),
        ("deadline", r"\b(by|deadline|due|launch|within|weeks?|months?)\b", "Is there a target date and what is driving it?", "No delivery date or business constraint was confirmed."),
    ]:
        if not re.search(pattern, brief, re.IGNORECASE):
            gaps.append({"question": question, "reason": reason, "priority": "high" if key in {"outcome", "dependencies"} else "medium"})

    capability_profile = team_capabilities or []
    capabilities = [
        {"capability": item, "status": "unknown", "evidence": "", "note": "The sample rules do not assess team fit; choose AI analysis for a profile comparison."}
        for item in capability_profile[:10]
    ] or [
        {"capability": "Team profile not provided", "status": "unknown", "evidence": "", "note": "Add verified team capabilities before assessing team fit."}
    ]
    improvements = [{"title": item["question"], "reason": item["reason"], "priority": item["priority"]} for item in gaps[:5]]
    return {
        "summary": "A preliminary view of the client's requested outcomes. Review each item and evidence before estimating.",
        "requirements": requirements,
        "initialAnswers": answers,
        "risks": [item["reason"] for item in gaps],
        "parser": "sample",
        "domain": "software and data integration" if integration else "general client work",
        "estimateMode": "integration" if migration or sync else "general",
        "missingInformation": gaps,
        "capabilityFindings": capabilities,
        "improvements": improvements,
        "qualityNotes": ["Sample parser uses deterministic rules; model inference is disabled for this run."],
        "agentRun": {
            "mode": "sample-rules",
            "model": None,
            "sessionId": None,
            "elapsedMs": 0,
            "subagentCount": 0,
            "steps": [
                {"id": "intake", "agent": "Intake analyst", "status": "complete", "summary": "Read pasted request text; no files were uploaded."},
                {"id": "scope", "agent": "Scope analyst", "status": "complete", "summary": f"Extracted {len(requirements)} candidate work item(s) with source passages."},
                {"id": "risk", "agent": "Delivery risk analyst", "status": "complete", "summary": f"Flagged {len(gaps)} missing-information question(s)."},
                {"id": "capability", "agent": "Capability analyst", "status": "not-run", "summary": "Sample rules do not analyze team capability; findings remain unknown."},
            ],
        },
    }


def normalize_agent_result(result: dict) -> dict:
    result["parser"] = "ai"
    result["risks"] = [item["reason"] for item in result["missingInformation"]]
    if result["estimateMode"] == "integration":
        category_map = {
            "api": "authentication", "authentication": "authentication", "mapping": "mapping",
            "import": "import", "migration": "import", "sync": "sync", "synchronization": "sync",
            "deduplication": "deduplication", "testing": "testing", "handover": "handover", "discovery": "discovery",
        }
        unsupported = [item["category"] for item in result["requirements"] if item["category"].strip().lower() not in category_map]
        if unsupported:
            raise ValueError("AI analysis returned an unsupported integration work category. Retry the analysis before reviewing scope.")
        categories = [category_map[item["category"].strip().lower()] for item in result["requirements"]]
        if len(categories) != len(set(categories)):
            raise ValueError("AI analysis returned duplicate integration work categories. Retry the analysis before reviewing scope.")
        result["requirements"] = [
            {"id": category_map[item["category"].strip().lower()], "title": item["title"], "evidence": item["evidence"]}
            for item in result["requirements"]
        ]
    else:
        seen: set[str] = set()
        for item in result["requirements"]:
            base_id = re.sub(r"[^a-zA-Z0-9-]+", "-", item["id"]).strip("-")[:64] or "work"
            candidate = base_id
            suffix = 2
            while candidate in seen:
                candidate = f"{base_id[:58]}-{suffix}"
                suffix += 1
            item["id"] = candidate
            seen.add(candidate)
    return result


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    try:
        auth_configured = bool(configured_service_token_keys())
    except ServiceAuthConfigurationError:
        auth_configured = False
    return {
        "status": "ready",
        "parser": "sample",
        "aiAvailable": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
        "analysisAuthConfigured": auth_configured,
    }


@app.post("/v1/briefs/analyze")
def analyze(request: AnalyzeRequest, _service: None = Depends(analysis_service_auth("briefs:analyze"))):
    capabilities = validate_capabilities(request.capabilities)
    if request.parser == "sample":
        result = sample_scope(request.brief, capabilities)
        result["source"] = {"name": "Pasted request", "type": "text", "characters": len(request.brief), "truncated": False, "reviewText": request.brief}
        return result
    if request.parser != "ai":
        raise HTTPException(status_code=422, detail="Choose the sample or AI analysis mode.")
    try:
        result = normalize_agent_result(run_agent_analysis(request.brief, capabilities))
        result["source"] = {"name": "Pasted request", "type": "text", "characters": len(request.brief), "truncated": False, "reviewText": request.brief}
        return result
    except RuntimeError as error:
        message = str(error)
        status = analysis_error_status(message)
        raise HTTPException(status_code=status, detail=message) from error
    except ValueError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/v1/briefs/analyze-document")
async def analyze_document(
    file: UploadFile = File(...),
    parser: str = Form("sample"),
    capabilities: str = Form("[]"),
    _service: None = Depends(analysis_service_auth("briefs:analyze-document")),
):
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    extracted = extract_document(PurePosixPath((file.filename or "client-file").replace("\\", "/")).name, raw)
    try:
        capability_profile = json.loads(capabilities)
        if not isinstance(capability_profile, list) or any(not isinstance(item, str) for item in capability_profile):
            raise ValueError("Capabilities must be a list of text values.")
    except (json.JSONDecodeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Team capabilities must be valid JSON text.") from error
    capability_profile = validate_capabilities(capability_profile)
    brief = str(extracted["text"])
    if parser == "sample":
        result = sample_scope(brief, capability_profile)
    elif parser == "ai":
        try:
            result = normalize_agent_result(await asyncio.to_thread(
                run_agent_analysis,
                brief,
                capability_profile,
                str(file.filename or "Client file"),
                str(extracted["extension"]),
            ))
        except (RuntimeError, ValueError) as error:
            status = analysis_error_status(str(error)) if isinstance(error, RuntimeError) else 502
            raise HTTPException(status_code=status, detail=str(error)) from error
    else:
        raise HTTPException(status_code=422, detail="Choose the sample or AI analysis mode.")
    result["source"] = {"name": PurePosixPath((file.filename or "Client file").replace("\\", "/")).name[:120], "type": extracted["extension"], "characters": len(brief), "truncated": extracted["truncated"], "reviewText": brief}
    result["agentRun"]["steps"][0]["summary"] = f"Extracted {len(brief):,} characters from {result['source']['name']}."
    return result


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1").strip()
    try:
        port = int(os.environ.get("PORT", "8001"))
    except ValueError as error:
        raise RuntimeError("PORT must be an integer between 1 and 65535.") from error
    if not host or not 1 <= port <= 65535:
        raise RuntimeError("HOST and PORT must identify a valid listener.")

    configure_json_logging()
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_config=None,
        access_log=False,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=10,
    )


if __name__ == "__main__":
    main()
