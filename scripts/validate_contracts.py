"""Validate the versioned preview API contract against live local service payloads."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import jwt
from jsonschema import Draft202012Validator
from openapi_spec_validator import validate_spec


ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "contracts" / "v1" / "openapi.json"
IDENTITY_SPEC_PATH = ROOT / "contracts" / "v1" / "identity-openapi.json"
SCOPING_DATASET_SCHEMA_PATH = ROOT / "evaluation" / "scoping-dataset.schema.json"
SCOPING_CANDIDATES_PATH = ROOT / "evaluation" / "scoping-candidates.jsonl"
LEARNING_POLICY_SCHEMA_PATH = ROOT / "docs" / "learning-policy-proposal.schema.json"
ROUTE_CHECK_PATH = ROOT / "scripts" / "check_bff_route.mjs"
WEB_HEALTH_CHECK_PATH = ROOT / "scripts" / "check_web_health.mjs"
BRIEF_DIR = ROOT / "services" / "brief-intelligence"
ESTIMATOR_DIR = ROOT / "services" / "estimator-go"
SAMPLE_BRIEF = (
    "Import 5,000 existing customer contacts from the client's legacy CRM into the new CRM. "
    "Connect the systems for a nightly one-way sync, map company and contact fields, and "
    "reconcile duplicate records before handover."
)
BRIEF_TEST_SECRET = "contract-test-brief-service-secret-0123456789-abcdef"
BRIEF_TEST_PREVIOUS_SECRET = "contract-test-brief-service-previous-secret-0123456789-abc"
BRIEF_TEST_KEY_ID = "contract-check-2026-10"


def local_ref_target(reference: str, spec: dict[str, Any]) -> Any:
    if not reference.startswith("#/"):
        raise ValueError(f"Only local OpenAPI references are supported: {reference}")
    target: Any = spec
    for raw_part in reference[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        target = target[part]
    return target


def expand_refs(value: Any, spec: dict[str, Any], stack: tuple[str, ...] = ()) -> Any:
    if isinstance(value, list):
        return [expand_refs(item, spec, stack) for item in value]
    if not isinstance(value, dict):
        return value
    if "$ref" in value:
        reference = value["$ref"]
        if reference in stack:
            raise ValueError(f"Recursive schema is not supported by this preview contract checker: {reference}")
        expanded = expand_refs(local_ref_target(reference, spec), spec, (*stack, reference))
        siblings = {key: item for key, item in value.items() if key != "$ref"}
        if siblings:
            if not isinstance(expanded, dict):
                raise ValueError(f"A $ref with sibling fields must point to an object schema: {reference}")
            expanded = {**expanded, **expand_refs(siblings, spec, stack)}
        return expanded
    return {key: expand_refs(item, spec, stack) for key, item in value.items()}


def schema_for(spec: dict[str, Any], component: str) -> dict[str, Any]:
    schema = expand_refs({"$ref": f"#/components/schemas/{component}"}, spec)
    Draft202012Validator.check_schema(schema)
    return schema


def validate_payload(spec: dict[str, Any], component: str, value: Any, label: str) -> None:
    schema = schema_for(spec, component)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(value),
        key=lambda error: (list(map(str, error.absolute_path)), error.message),
    )
    if errors:
        details = "\n".join(
            f"  - {label}{''.join(f'[{part!r}]' for part in error.absolute_path)}: {error.message}"
            for error in errors
        )
        raise ValueError(f"{component} payload does not match the contract:\n{details}")


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def json_request(
    url: str,
    payload: Any | None = None,
    timeout: float = 3,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {"content-type": "application/json"} if data is not None else {}
    request_headers.update(headers or {})
    request = Request(
        url,
        data=data,
        headers=request_headers,
        method="POST" if data is not None else "GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


def text_file_request(url: str, filename: str, content: str, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    boundary = "estimator-contract-boundary"
    file_part = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        "Content-Type: text/plain; charset=utf-8\r\n\r\n"
        f"{content}\r\n"
    )
    fields = "".join(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        for name, value in (("parser", "sample"), ("capabilities", "[]"))
    )
    data = (file_part + fields + f"--{boundary}--\r\n").encode("utf-8")
    request = Request(
        url,
        data=data,
        headers={"content-type": f"multipart/form-data; boundary={boundary}", **(headers or {})},
        method="POST",
    )
    try:
        with urlopen(request, timeout=3) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


def brief_service_token(scope: str, *, overrides: dict[str, Any] | None = None, key_id: str = BRIEF_TEST_KEY_ID, secret: str = BRIEF_TEST_SECRET) -> str:
    issued_at = int(time.time())
    claims: dict[str, Any] = {
        "iss": "the-estimator-web",
        "aud": "the-estimator-brief-intelligence",
        "sub": "the-estimator-web",
        "scope": scope,
        "iat": issued_at,
        "exp": issued_at + 45,
        "jti": str(uuid.uuid4()),
    }
    claims.update(overrides or {})
    return jwt.encode(claims, secret, algorithm="HS256", headers={"typ": "JWT", "kid": key_id})


def wait_until_ready(process: subprocess.Popen[bytes], url: str, name: str) -> None:
    deadline = time.monotonic() + 45
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{name} exited before becoming ready (exit {process.returncode}).")
        try:
            status, body = json_request(url, timeout=1)
            if status == 200 and isinstance(body, dict):
                return
        except (OSError, URLError, TimeoutError, ValueError) as error:
            last_error = error
        time.sleep(0.25)
    raise RuntimeError(f"{name} did not become ready within 45 seconds: {last_error}")


def stop_process(process: subprocess.Popen[bytes] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def check_structured_logs(output: str, service: str) -> None:
    lines = [line for line in output.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"{service} emitted no operational logs.")
    records = []
    for line in lines:
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{service} emitted a non-JSON log line: {line!r}") from error
        if not isinstance(record, dict) or record.get("service") != service:
            raise RuntimeError(f"{service} emitted an invalid log record: {record!r}")
        if not all(key in record for key in ("timestamp", "severity", "event")):
            raise RuntimeError(f"{service} log record lacks standard fields: {record!r}")
        if "http_request" == record.get("event"):
            if not all(key in record for key in ("request_id", "method", "path", "status", "duration_ms")):
                raise RuntimeError(f"{service} HTTP log lacks request fields: {record!r}")
            if "?" in record["path"]:
                raise RuntimeError(f"{service} HTTP log included a query string: {record!r}")
        records.append(record)
    if SAMPLE_BRIEF in output:
        raise RuntimeError(f"{service} included the submitted brief in its logs.")
    if not any(record.get("event") == "http_request" for record in records):
        raise RuntimeError(f"{service} emitted no structured HTTP request log.")


def validate_service_token_scopes(spec: dict[str, Any]) -> None:
    expected = {
        ("/v1/records", "get"): "private-records:read",
        ("/v1/records", "post"): "private-records:create",
        ("/v1/records", "delete"): "private-records:delete",
        ("/v1/records/{recordID}", "get"): "private-records:read",
        ("/v1/records/{recordID}", "patch"): "private-records:update",
        ("/v1/records/{recordID}", "delete"): "private-records:delete",
        ("/v1/records/{recordID}/delivery", "post"): "private-records:update",
        ("/v1/records/{recordID}/delivery/review", "patch"): "private-records:update",
    }
    paths = spec["paths"]
    for (path, method), scope in expected.items():
        operation = paths.get(path, {}).get(method)
        if not isinstance(operation, dict) or operation.get("x-required-service-scope") != scope:
            raise ValueError(f"{method.upper()} {path} must declare service scope {scope!r}.")

    for path, scope in {
        "/v1/briefs/analyze": "briefs:analyze",
        "/v1/briefs/analyze-document": "briefs:analyze-document",
    }.items():
        operation = paths.get(path, {}).get("post")
        if (
            not isinstance(operation, dict)
            or operation.get("x-required-service-scope") != scope
            or operation.get("security") != [{"briefServiceToken": []}]
            or "401" not in operation.get("responses", {})
        ):
            raise ValueError(f"POST {path} must declare its internal service-token scope and 401 response.")


def validate_record_contract_compatibility(spec: dict[str, Any]) -> None:
    estimate = {
        "tasks": [], "low": 1, "high": 2, "hours": 1.5, "baseHours": 1.5,
        "blockers": [], "assumptions": [], "references": [],
        "provenance": {
            "engineVersion": "integration-effort/2.0", "historyPolicy": "recorded",
            "similarityThreshold": 0.45, "priorObservations": 4, "ratioBounds": [0.35, 3],
            "driverWeights": {"direction": 3, "api": 3, "quality": 2, "volume": 1, "mapping": 2},
            "referenceIds": [], "policyVersion": "fixed-calibration/v1",
        },
    }
    payload_v1 = {
        "schemaVersion": 1, "title": "Legacy snapshot",
        "source": {"name": "brief.txt", "type": "text/plain", "characters": 10, "truncated": False, "reviewText": "A short brief"},
        "suggestedScope": {}, "reviewedScope": {}, "estimate": estimate, "originalFile": None, "deliveryOutcome": None,
    }
    payload_v1["estimate"] = {**estimate, "provenance": {key: value for key, value in estimate["provenance"].items() if key != "policyVersion"}}
    validate_payload(spec, "PrivateRecordSnapshotPayload", payload_v1, "version 1 legacy record")
    payload_v2 = {
        **payload_v1, "schemaVersion": 2, "estimate": estimate,
        "baseline": {"id": "00000000-0000-4000-8000-000000000001", "createdAt": "2026-10-18T12:00:00Z", "sha256": "a" * 64, "estimateSha256": "b" * 64, "reviewedScopeSha256": "c" * 64, "engineVersion": "integration-effort/2.0", "policyVersion": "fixed-calibration/v1", "evaluationSplit": "training", "workPackageIds": ["import"]},
        "provenance": {"sourceSha256": "d" * 64, "analysis": {"status": "succeeded"}},
        "reviewDecisions": [{"id": "00000000-0000-4000-8000-000000000002", "kind": "scope-approved", "at": "2026-10-18T12:00:00Z", "actorId": "00000000-0000-4000-8000-000000000003", "decision": "approved"}],
    }
    validate_payload(spec, "PrivateRecordSnapshotPayload", payload_v2, "version 2 reviewed record")
    create_v2 = {key: value for key, value in payload_v2.items() if key not in ("baseline", "provenance", "reviewDecisions")}
    validate_payload(spec, "PrivateRecordCreate", {"schemaVersion": 2, "reviewConfirmed": True, "payload": create_v2}, "version 2 create input without server-assigned provenance")
    for label, invalid in (("unsupported record version", {**payload_v2, "schemaVersion": 99}), ("legacy record with delivery data", {**payload_v1, "deliveryOutcome": {"hours": 4}})):
        try:
            validate_payload(spec, "PrivateRecordSnapshotPayload", invalid, label)
        except ValueError:
            continue
        raise ValueError(f"{label} unexpectedly matched the private record contract")


def validate_learning_artifact_schemas() -> None:
    with SCOPING_DATASET_SCHEMA_PATH.open(encoding="utf-8-sig") as source:
        dataset_schema = json.load(source)
    with LEARNING_POLICY_SCHEMA_PATH.open(encoding="utf-8-sig") as source:
        policy_schema = json.load(source)
    Draft202012Validator.check_schema(dataset_schema)
    Draft202012Validator.check_schema(policy_schema)
    dataset_validator = Draft202012Validator(dataset_schema)
    for line_number, line in enumerate(SCOPING_CANDIDATES_PATH.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        case = json.loads(line)
        errors = list(dataset_validator.iter_errors(case))
        if errors:
            raise ValueError(f"scoping candidate line {line_number} is invalid: {errors[0].message}")
    valid_proposal = {
        "schemaVersion": 1, "proposalId": "reviewed-proposal-example", "status": "approved",
        "currentPolicyVersion": "fixed-calibration/v1", "proposedPolicyVersion": "fixed-calibration/v2",
        "affectedDomain": "integration", "cohort": "recorded-holdout", "sampleCount": 30,
        "evidence": {"trainingReport": "training.json", "heldOutReport": "holdout.json", "currentBehavior": "baseline policy", "proposedBehavior": "reviewed adjustment", "limitations": ["Descriptive cohort only."]},
        "review": {"reviewerId": "reviewer-1", "reviewedAt": "2026-10-18T12:00:00Z", "decision": "approved", "note": "Evidence and limitations reviewed."},
        "rollbackPolicyVersion": "fixed-calibration/v1",
    }
    if list(Draft202012Validator(policy_schema).iter_errors(valid_proposal)):
        raise ValueError("learning policy proposal schema rejected its valid approval example")
    invalid_proposal = {**valid_proposal, "review": {**valid_proposal["review"], "decision": "rejected"}}
    if not list(Draft202012Validator(policy_schema).iter_errors(invalid_proposal)):
        raise ValueError("learning policy proposal schema accepted a mismatched approval decision")


def check_service_health(spec: dict[str, Any], base_url: str, name: str, readiness_schema: str) -> None:
    for path, component in (("/health/live", "HealthLive"), ("/health/ready", readiness_schema)):
        status, body = json_request(f"{base_url}{path}")
        if status != 200:
            raise RuntimeError(f"{name} {path} returned HTTP {status}: {body}")
        validate_payload(spec, component, body, f"{name} {path} response")


def check_brief_service_auth(spec: dict[str, Any], base_url: str) -> None:
    endpoint = f"{base_url}/v1/briefs/analyze"
    request = {"brief": SAMPLE_BRIEF, "parser": "sample"}
    cases = {
        "missing": None,
        "expired": brief_service_token("briefs:analyze", overrides={"iat": int(time.time()) - 120, "exp": int(time.time()) - 60}),
        "wrong issuer": brief_service_token("briefs:analyze", overrides={"iss": "another-service"}),
        "wrong audience": brief_service_token("briefs:analyze", overrides={"aud": "the-estimator-go"}),
        "wrong scope": brief_service_token("private-records:read"),
        "unknown key ID": brief_service_token("briefs:analyze", key_id="unknown-key"),
        "invalid signature": brief_service_token("briefs:analyze", secret="another-brief-service-secret-0123456789-abcdef-long"),
        "overlong token lifetime": brief_service_token("briefs:analyze", overrides={"exp": int(time.time()) + 61}),
    }
    for name, token in cases.items():
        headers = {} if token is None else {"authorization": f"Bearer {token}"}
        status, body = json_request(endpoint, request, headers=headers)
        if status != 401:
            raise RuntimeError(f"Python brief service accepted {name} service credentials: HTTP {status} {body}")
        validate_payload(spec, "PythonError", body, f"Python {name} credential rejection")

    wrong_document_scope = brief_service_token("briefs:analyze")
    document_status, document_body = text_file_request(
        f"{base_url}/v1/briefs/analyze-document",
        "fictional-client-brief.txt",
        "A fictional onboarding guide and project planning workshop.",
        headers={"authorization": f"Bearer {wrong_document_scope}"},
    )
    if document_status != 401:
        raise RuntimeError(f"Python document service accepted the pasted-text scope: HTTP {document_status} {document_body}")
    validate_payload(spec, "PythonError", document_body, "Python document wrong-scope rejection")

    previous_key_token = brief_service_token(
        "briefs:analyze",
        key_id="previous-2026-09",
        secret=BRIEF_TEST_PREVIOUS_SECRET,
    )
    previous_status, previous_body = json_request(
        endpoint,
        request,
        headers={"authorization": f"Bearer {previous_key_token}"},
    )
    if previous_status != 200:
        raise RuntimeError(f"Python service did not accept the configured previous key during rotation: HTTP {previous_status} {previous_body}")


def check_brief_auth_unit_tests() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", str(BRIEF_DIR), "-p", "test_*.py"],
        cwd=ROOT,
        capture_output=True,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Python service-auth unit tests failed. "
            f"stdout: {completed.stdout.strip()} stderr: {completed.stderr.strip()}"
        )


def check_bff_route(spec: dict[str, Any], scope: dict[str, Any], estimate: dict[str, Any]) -> None:
    environment = {
        **os.environ,
        "BRIEF_SERVICE_TOKEN_SECRET": BRIEF_TEST_SECRET,
        "BRIEF_SERVICE_TOKEN_KEY_ID": BRIEF_TEST_KEY_ID,
        "SERVICE_TOKEN_SECRET": "separate-record-service-secret-0123456789-abcdef",
    }
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROUTE_CHECK_PATH)],
        cwd=ROOT,
        env=environment,
        input=json.dumps({"scope": scope, "estimate": estimate}),
        capture_output=True,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "BFF route checks failed. "
            f"stdout: {completed.stdout.strip()} stderr: {completed.stderr.strip()}"
        )
    try:
        results = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"BFF route checker did not return JSON: {completed.stdout!r}") from error
    if not isinstance(results, list) or any(not isinstance(item, dict) for item in results):
        raise RuntimeError(f"BFF route checker returned an invalid result list: {results!r}")

    expected_statuses = {
        "analysis-success": 200,
        "document-analysis-success": 200,
        "analysis-missing-service-configuration": 503,
        "malformed-json": 400,
        "oversized-body": 413,
        "ai-provider-error": 503,
        "python-error": 422,
        "python-timeout-response": 503,
        "estimate-success": 200,
        "general-estimate-success": 200,
        "estimate-unconfirmed": 400,
        "estimate-invalid-evidence": 422,
        "estimator-error": 422,
        "upstream-unavailable": 503,
        "brief-timeout": 503,
        "estimator-timeout": 503,
    }
    expected_errors = {
        "analysis-missing-service-configuration": "The analysis service is not configured.",
        "malformed-json": "Request body must be valid JSON.",
        "oversized-body": "Request body is too large.",
        "ai-provider-error": "AI session permission is missing.",
        "python-error": "This brief is not supported.",
        "python-timeout-response": "The analysis took too long. Try again or use sample mode.",
        "estimator-error": "Invalid estimate request.",
        "upstream-unavailable": "A preview service is unavailable. Start the local services and try again.",
        "brief-timeout": "A service took too long to respond. Try again or use sample mode.",
        "estimator-timeout": "A service took too long to respond. Try again or use sample mode.",
    }
    actual_names = {item.get("name") for item in results}
    if actual_names != set(expected_statuses):
        raise RuntimeError(
            "BFF route checker returned unexpected scenarios: "
            f"expected {sorted(expected_statuses)}, received {sorted(actual_names)}"
        )
    for result in results:
        name = result["name"]
        status = result.get("status")
        if status != expected_statuses[name]:
            raise RuntimeError(f"BFF {name} scenario returned HTTP {status}; expected {expected_statuses[name]}.")
        is_estimate = name.startswith("estimate") or name == "estimator-error" or name == "estimator-timeout"
        route = "/api/v1/preview/estimate" if is_estimate else "/api/v1/preview"
        documented_responses = spec["paths"][route]["post"]["responses"]
        if str(status) not in documented_responses:
            raise RuntimeError(f"BFF HTTP {status} from {name} on {route} is missing from the OpenAPI responses.")
        body = result.get("body")
        if name in expected_errors and (not isinstance(body, dict) or body.get("error") != expected_errors[name]):
            raise RuntimeError(f"BFF {name} returned an unexpected error body: {body!r}")
        if name in {"analysis-success", "document-analysis-success"} and (not isinstance(body, dict) or "scope" not in body or "estimate" in body):
            raise RuntimeError(f"BFF analysis must return scope without calculating an estimate: {body!r}")
        component = (
            "PreviewResponse" if name in {"analysis-success", "document-analysis-success"}
            else "EstimateConfirmationResponse" if name in {"estimate-success", "general-estimate-success"}
            else "BFFError"
        )
        validate_payload(spec, component, body, f"BFF {name} HTTP {status} response")


def check_web_health(spec: dict[str, Any], brief_base: str, estimate_base: str) -> None:
    environment = {
        **os.environ,
        "BRIEF_SERVICE_URL": brief_base,
        "ESTIMATOR_SERVICE_URL": estimate_base,
    }
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(WEB_HEALTH_CHECK_PATH)],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Web health route checks failed. "
            f"stdout: {completed.stdout.strip()} stderr: {completed.stderr.strip()}"
        )
    try:
        results = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Web health checker did not return JSON: {completed.stdout!r}") from error
    expected = {
        "web-live": (200, "HealthLive"),
        "web-ready": (200, "WebServiceReady"),
        "web-not-ready": (503, "WebServiceNotReady"),
    }
    if not isinstance(results, list) or {item.get("name") for item in results} != set(expected):
        raise RuntimeError(f"Web health checker returned unexpected results: {results!r}")
    for result in results:
        name = result["name"]
        status, schema = expected[name]
        if result.get("status") != status:
            raise RuntimeError(f"Web {name} returned HTTP {result.get('status')}; expected {status}.")
        validate_payload(spec, schema, result.get("body"), f"Web {name} HTTP {status} response")


def check_live_payloads(spec: dict[str, Any]) -> None:
    brief_port, estimate_port = free_port(), free_port()
    while estimate_port == brief_port:
        estimate_port = free_port()

    environment = os.environ.copy()
    brief_env = {
        **environment,
        "HOST": "127.0.0.1",
        "PORT": str(brief_port),
        "REQUEST_TIMEOUT_SECONDS": "8",
        "BRIEF_SERVICE_TOKEN_KEY_ID": BRIEF_TEST_KEY_ID,
        "BRIEF_SERVICE_TOKEN_SECRET": BRIEF_TEST_SECRET,
        "BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS": json.dumps({"previous-2026-09": BRIEF_TEST_PREVIOUS_SECRET}),
    }
    brief_env.pop("OPENAI_API_KEY", None)
    brief_env.pop("AGENT_MODEL", None)
    estimate_env = {**environment, "HOST": "127.0.0.1", "PORT": str(estimate_port), "REQUEST_TIMEOUT": "8s"}
    brief_process: subprocess.Popen[bytes] | None = None
    estimate_process: subprocess.Popen[bytes] | None = None

    with tempfile.TemporaryDirectory(prefix="estimator-contracts-") as temp_dir:
        executable = Path(temp_dir) / ("estimator.exe" if os.name == "nt" else "estimator")
        brief_log_path = Path(temp_dir) / "brief-intelligence.log"
        estimate_log_path = Path(temp_dir) / "estimator-go.log"
        subprocess.run(
            ["go", "build", "-o", str(executable), "./cmd/estimator"],
            cwd=ESTIMATOR_DIR,
            check=True,
        )
        brief_log = brief_log_path.open("w+", encoding="utf-8")
        estimate_log = estimate_log_path.open("w+", encoding="utf-8")

        try:
            brief_process = subprocess.Popen(
                [sys.executable, str(BRIEF_DIR / "main.py")],
                cwd=ROOT,
                env=brief_env,
                stdout=brief_log,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            estimate_process = subprocess.Popen(
                [str(executable)],
                cwd=ESTIMATOR_DIR,
                env=estimate_env,
                stdout=estimate_log,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )

            brief_base = f"http://127.0.0.1:{brief_port}"
            estimate_base = f"http://127.0.0.1:{estimate_port}"
            wait_until_ready(brief_process, f"{brief_base}/health/ready", "Python brief service")
            wait_until_ready(estimate_process, f"{estimate_base}/health/ready", "Go estimator")
            check_service_health(spec, brief_base, "Python brief service", "BriefServiceReady")
            check_service_health(spec, estimate_base, "Go estimator", "EstimatorServiceReady")
            check_brief_service_auth(spec, brief_base)
            check_web_health(spec, brief_base, estimate_base)

            brief_request = {"brief": SAMPLE_BRIEF, "parser": "sample"}
            validate_payload(spec, "BriefAnalyzeRequest", brief_request, "Python request")
            brief_headers = {"authorization": f"Bearer {brief_service_token('briefs:analyze')}"}
            brief_status, scope = json_request(f"{brief_base}/v1/briefs/analyze", brief_request, headers=brief_headers)
            if brief_status != 200:
                raise RuntimeError(f"Python brief service returned HTTP {brief_status}: {scope}")
            validate_payload(spec, "Scope", scope, "Python response")
            if scope.get("source", {}).get("reviewText") != SAMPLE_BRIEF:
                raise RuntimeError("Python analysis did not return the extracted source needed to verify reviewed evidence.")
            if any(item.get("evidenceStatus") != "verified" for item in scope.get("requirements", [])):
                raise RuntimeError("The deterministic sample parser marked a direct source passage as unverified.")
            document_brief = "Prepare a fictional onboarding guide and facilitate a project planning workshop for the delivery team."
            document_status, document_scope = text_file_request(
                f"{brief_base}/v1/briefs/analyze-document",
                "fictional-client-brief.txt",
                document_brief,
                headers={"authorization": f"Bearer {brief_service_token('briefs:analyze-document')}"},
            )
            if document_status != 200:
                raise RuntimeError(f"Python document intake returned HTTP {document_status}: {document_scope}")
            validate_payload(spec, "Scope", document_scope, "Python document response")
            if document_scope.get("source", {}).get("name") != "fictional-client-brief.txt" or document_scope.get("source", {}).get("type") != "txt" or document_scope.get("source", {}).get("reviewText") != document_brief:
                raise RuntimeError("Python document intake did not preserve filename, type and extracted source text.")

            integration_scope = {
                "summary": scope["summary"],
                "requirements": [
                    {"id": item["id"], "title": item["title"], "evidence": item["evidence"]}
                    for item in scope["requirements"]
                ],
                "initialAnswers": scope["initialAnswers"],
                "risks": scope["risks"],
                "parser": scope["parser"],
            }
            estimate_request = {
                "scope": integration_scope,
                "answers": scope["initialAnswers"],
                "excluded": [],
                "historyPolicy": "demo",
            }
            validate_payload(spec, "EstimateRequest", estimate_request, "Go request")
            estimate_status, estimate = json_request(f"{estimate_base}/v1/estimates", estimate_request)
            if estimate_status != 200:
                raise RuntimeError(f"Go estimator returned HTTP {estimate_status}: {estimate}")
            validate_payload(spec, "Estimate", estimate, "Go response")

            preview_request = {"brief": SAMPLE_BRIEF, "parser": "sample"}
            validate_payload(spec, "PreviewRequest", preview_request, "BFF request")
            validate_payload(
                spec,
                "PreviewResponse",
                {"scope": scope},
                "BFF analysis response",
            )

            general_brief = (
                "Prepare a project onboarding handbook and facilitate a planning workshop "
                "for a 12-person team. Include a one-page guide."
            )
            general_status, general_scope = json_request(
                f"{brief_base}/v1/briefs/analyze",
                {"brief": general_brief, "parser": "sample"},
                headers=brief_headers,
            )
            if general_status != 200 or general_scope.get("estimateMode") != "general":
                raise RuntimeError(f"Expected general-work analysis for the fictional workshop brief, received {general_status}: {general_scope}")
            validate_payload(spec, "Scope", general_scope, "Python general-work response")
            general_request = {
                "workPackages": [
                    {"id": item["id"], "title": item["title"], "complexity": item["complexity"]}
                    for item in general_scope["requirements"]
                ]
            }
            validate_payload(spec, "GeneralEstimateRequest", general_request, "Go general-work request")
            general_status, general_estimate = json_request(
                f"{estimate_base}/v1/estimates/general", general_request
            )
            if general_status != 200:
                raise RuntimeError(f"Go general-work estimator returned HTTP {general_status}: {general_estimate}")
            validate_payload(spec, "Estimate", general_estimate, "Go general-work response")
            check_bff_route(spec, scope, estimate)
            validate_payload(
                spec,
                "BFFError",
                {"error": "A preview service is unavailable. Start the local services and try again."},
                "BFF string error response",
            )
            validate_payload(
                spec,
                "BFFError",
                {
                    "error": [
                        {
                            "loc": ["body", "brief"],
                            "msg": "String should have at least 30 characters",
                            "type": "string_too_short",
                        }
                    ]
                },
                "BFF validation error response",
            )

            ai_request = {"brief": SAMPLE_BRIEF, "parser": "ai"}
            validate_payload(spec, "PreviewRequest", ai_request, "BFF AI request")
            invalid_brief = "Too short."
            brief_error_status, brief_error = json_request(
                f"{brief_base}/v1/briefs/analyze",
                {"brief": invalid_brief, "parser": "sample"},
                headers=brief_headers,
            )
            if brief_error_status != 422:
                raise RuntimeError(f"Expected Python short-brief response 422, received {brief_error_status}.")
            validate_payload(spec, "PythonError", brief_error, "Python 422 response")
            parser_error_status, parser_error = json_request(
                f"{brief_base}/v1/briefs/analyze",
                {"brief": SAMPLE_BRIEF, "parser": "ai"},
                headers=brief_headers,
            )
            if parser_error_status != 503:
                raise RuntimeError(f"Expected Python unconfigured-parser response 503, received {parser_error_status}.")
            validate_payload(spec, "PythonError", parser_error, "Python 503 response")

            unknown_field_status, unknown_field_error = json_request(
                f"{estimate_base}/v1/estimates", {**estimate_request, "unexpected": True}
            )
            if unknown_field_status != 400:
                raise RuntimeError(f"Expected Go unknown-field response 400, received {unknown_field_status}.")
            validate_payload(spec, "GoError", unknown_field_error, "Go 400 response")

            invalid_estimate = {**estimate_request, "answers": {**estimate_request["answers"], "api": "unsupported"}}
            estimate_error_status, estimate_error = json_request(
                f"{estimate_base}/v1/estimates", invalid_estimate
            )
            if estimate_error_status != 422:
                raise RuntimeError(f"Expected Go invalid-answers response 422, received {estimate_error_status}.")
            validate_payload(spec, "GoError", estimate_error, "Go 422 response")
        finally:
            stop_process(estimate_process)
            stop_process(brief_process)
            brief_log.close()
            estimate_log.close()
        check_structured_logs(brief_log_path.read_text(encoding="utf-8"), "brief-intelligence")
        check_structured_logs(estimate_log_path.read_text(encoding="utf-8"), "estimator-go")


def main() -> int:
    try:
        with SPEC_PATH.open(encoding="utf-8") as contract_file:
            spec = json.load(contract_file)
        with IDENTITY_SPEC_PATH.open(encoding="utf-8") as contract_file:
            identity_spec = json.load(contract_file)
        validate_spec(spec)
        validate_spec(identity_spec)
        validate_service_token_scopes(spec)
        validate_record_contract_compatibility(spec)
        validate_learning_artifact_schemas()
        check_brief_auth_unit_tests()
        for component in spec["components"]["schemas"]:
            schema_for(spec, component)
        for component in identity_spec["components"]["schemas"]:
            schema_for(identity_spec, component)
        check_live_payloads(spec)
    except Exception as error:  # print a single actionable failure to keep this a small local check
        print(f"Contract check failed: {error}", file=sys.stderr)
        return 1

    print("Application and first-party identity OpenAPI 3.1 contracts are valid, including the private-record service-scope mapping.")
    print("Live web, Python and Go health payloads, structured service logs and actual BFF success/error/timeout responses match their contracts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
