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

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


def _request_timeout_seconds() -> float:
    raw = os.environ.get("REQUEST_TIMEOUT_SECONDS", "8")
    try:
        value = float(raw)
    except ValueError as error:
        raise RuntimeError("REQUEST_TIMEOUT_SECONDS must be between 1 and 30.") from error
    if not math.isfinite(value) or not 1 <= value <= 30:
        raise RuntimeError("REQUEST_TIMEOUT_SECONDS must be between 1 and 30.")
    return value


REQUEST_TIMEOUT_SECONDS = _request_timeout_seconds()
REQUEST_ID_PATTERN = re.compile(
    r"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$",
    re.IGNORECASE,
)


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


class AnalyzeRequest(BaseModel):
    brief: str = Field(min_length=30, max_length=20_000)
    parser: str = "sample"


def sample_scope(brief: str) -> dict:
    lines = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", brief) if part.strip()]

    def evidence(pattern: str) -> str:
        return next((line for line in lines if re.search(pattern, line, re.IGNORECASE)), "")

    migration = evidence(r"\b(csv|migrat\w*|import\w*|historical|legacy)\b")
    sync = evidence(r"\b(sync\w*|nightly|every night|integrat\w*|connect\w*)\b")
    dedup = evidence(r"\b(duplicat\w*|dedup\w*|reconcil\w*)\b")
    if not migration and not sync:
        raise HTTPException(status_code=422, detail="This MVP supports data imports and CRM / API integrations. Describe the import or integration you need.")

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

    requirements = [{"id": "mapping", "title": "Map records to destination fields", "evidence": migration or sync}]
    if migration:
        requirements.append({"id": "import", "title": "Import historical records", "evidence": migration})
    if sync:
        requirements.append({"id": "sync", "title": "Connect systems and synchronize updates", "evidence": sync})
    if dedup:
        requirements.append({"id": "deduplication", "title": "Detect duplicates and reconcile records", "evidence": dedup})
    return {
        "summary": "Deliver a reliable connection between client systems and clean, reusable customer data.",
        "requirements": requirements,
        "initialAnswers": answers,
        "risks": [
            "Acceptance criteria and field mappings need delivery review.",
            "The client's requested date is a constraint, not a confirmed delivery commitment.",
        ],
        "parser": "demo",
    }


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    return {"status": "ready", "parser": "sample"}


@app.post("/v1/briefs/analyze")
def analyze(request: AnalyzeRequest):
    if request.parser != "sample":
        raise HTTPException(status_code=503, detail="AI parsing is not configured. Choose the sample parser.")
    return sample_scope(request.brief)


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
