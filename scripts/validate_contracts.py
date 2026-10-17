"""Validate the versioned preview API contract against live local service payloads."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from jsonschema import Draft202012Validator
from openapi_spec_validator import validate_spec


ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "contracts" / "v1" / "openapi.json"
ROUTE_CHECK_PATH = ROOT / "scripts" / "check_bff_route.mjs"
WEB_HEALTH_CHECK_PATH = ROOT / "scripts" / "check_web_health.mjs"
BRIEF_DIR = ROOT / "services" / "brief-intelligence"
ESTIMATOR_DIR = ROOT / "services" / "estimator-go"
SAMPLE_BRIEF = (
    "Import 5,000 existing customer contacts from the client's legacy CRM into the new CRM. "
    "Connect the systems for a nightly one-way sync, map company and contact fields, and "
    "reconcile duplicate records before handover."
)


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


def json_request(url: str, payload: Any | None = None, timeout: float = 3) -> tuple[int, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=data,
        headers={"content-type": "application/json"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


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


def check_structured_logs(process: subprocess.Popen[str], service: str) -> None:
    output, _ = process.communicate(timeout=5)
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


def check_service_health(spec: dict[str, Any], base_url: str, name: str, readiness_schema: str) -> None:
    for path, component in (("/health/live", "HealthLive"), ("/health/ready", readiness_schema)):
        status, body = json_request(f"{base_url}{path}")
        if status != 200:
            raise RuntimeError(f"{name} {path} returned HTTP {status}: {body}")
        validate_payload(spec, component, body, f"{name} {path} response")


def check_bff_route(spec: dict[str, Any], scope: dict[str, Any], estimate: dict[str, Any]) -> None:
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROUTE_CHECK_PATH)],
        cwd=ROOT,
        input=json.dumps({"scope": scope, "estimate": estimate}),
        capture_output=True,
        check=False,
        text=True,
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
        "success": 200,
        "malformed-json": 400,
        "oversized-body": 413,
        "ai-unconfigured": 503,
        "python-error": 422,
        "python-timeout-response": 503,
        "estimator-error": 422,
        "upstream-unavailable": 503,
        "brief-timeout": 503,
        "estimator-timeout": 503,
    }
    expected_errors = {
        "malformed-json": "Request body must be valid JSON.",
        "oversized-body": "Request body is too large.",
        "ai-unconfigured": "AI parsing is not configured. Choose the sample parser.",
        "python-error": "This brief is not supported.",
        "python-timeout-response": "A service took too long to respond. Try again.",
        "estimator-error": "Invalid estimate request.",
        "upstream-unavailable": "A preview service is unavailable. Start the local services and try again.",
        "brief-timeout": "A service took too long to respond. Try again.",
        "estimator-timeout": "A service took too long to respond. Try again.",
    }
    actual_names = {item.get("name") for item in results}
    if actual_names != set(expected_statuses):
        raise RuntimeError(
            "BFF route checker returned unexpected scenarios: "
            f"expected {sorted(expected_statuses)}, received {sorted(actual_names)}"
        )
    documented_responses = spec["paths"]["/api/v1/preview"]["post"]["responses"]
    for result in results:
        name = result["name"]
        status = result.get("status")
        if status != expected_statuses[name]:
            raise RuntimeError(f"BFF {name} scenario returned HTTP {status}; expected {expected_statuses[name]}.")
        if str(status) not in documented_responses:
            raise RuntimeError(f"BFF HTTP {status} from {name} is missing from the OpenAPI responses.")
        body = result.get("body")
        if name in expected_errors and (not isinstance(body, dict) or body.get("error") != expected_errors[name]):
            raise RuntimeError(f"BFF {name} returned an unexpected error body: {body!r}")
        component = "PreviewResponse" if name == "success" else "BFFError"
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
    brief_env = {**environment, "HOST": "127.0.0.1", "PORT": str(brief_port), "REQUEST_TIMEOUT_SECONDS": "8"}
    estimate_env = {**environment, "HOST": "127.0.0.1", "PORT": str(estimate_port), "REQUEST_TIMEOUT": "8s"}
    brief_process: subprocess.Popen[bytes] | None = None
    estimate_process: subprocess.Popen[bytes] | None = None

    with tempfile.TemporaryDirectory(prefix="estimator-contracts-") as temp_dir:
        executable = Path(temp_dir) / ("estimator.exe" if os.name == "nt" else "estimator")
        subprocess.run(
            ["go", "build", "-o", str(executable), "./cmd/estimator"],
            cwd=ESTIMATOR_DIR,
            check=True,
        )
        try:
            brief_process = subprocess.Popen(
                [sys.executable, str(BRIEF_DIR / "main.py")],
                cwd=ROOT,
                env=brief_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            estimate_process = subprocess.Popen(
                [str(executable)],
                cwd=ESTIMATOR_DIR,
                env=estimate_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )

            brief_base = f"http://127.0.0.1:{brief_port}"
            estimate_base = f"http://127.0.0.1:{estimate_port}"
            wait_until_ready(brief_process, f"{brief_base}/health/ready", "Python brief service")
            wait_until_ready(estimate_process, f"{estimate_base}/health/ready", "Go estimator")
            check_service_health(spec, brief_base, "Python brief service", "BriefServiceReady")
            check_service_health(spec, estimate_base, "Go estimator", "EstimatorServiceReady")
            check_web_health(spec, brief_base, estimate_base)

            brief_request = {"brief": SAMPLE_BRIEF, "parser": "sample"}
            validate_payload(spec, "BriefAnalyzeRequest", brief_request, "Python request")
            brief_status, scope = json_request(f"{brief_base}/v1/briefs/analyze", brief_request)
            if brief_status != 200:
                raise RuntimeError(f"Python brief service returned HTTP {brief_status}: {scope}")
            validate_payload(spec, "Scope", scope, "Python response")

            estimate_request = {
                "scope": scope,
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
                {"scope": scope, "estimate": estimate},
                "BFF response",
            )
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
            validate_payload(
                spec,
                "BFFError",
                {"error": "AI parsing is not configured. Choose the sample parser."},
                "BFF AI-unavailable response",
            )

            invalid_brief = "Our customer team needs a cleaner place to coordinate account work."
            brief_error_status, brief_error = json_request(
                f"{brief_base}/v1/briefs/analyze", {"brief": invalid_brief, "parser": "sample"}
            )
            if brief_error_status != 422:
                raise RuntimeError(f"Expected Python unsupported-scope response 422, received {brief_error_status}.")
            validate_payload(spec, "PythonError", brief_error, "Python 422 response")
            parser_error_status, parser_error = json_request(
                f"{brief_base}/v1/briefs/analyze", {"brief": SAMPLE_BRIEF, "parser": "ai"}
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
        check_structured_logs(brief_process, "brief-intelligence")
        check_structured_logs(estimate_process, "estimator-go")


def main() -> int:
    try:
        with SPEC_PATH.open(encoding="utf-8") as contract_file:
            spec = json.load(contract_file)
        validate_spec(spec)
        for component in spec["components"]["schemas"]:
            schema_for(spec, component)
        check_live_payloads(spec)
    except Exception as error:  # print a single actionable failure to keep this a small local check
        print(f"Contract check failed: {error}", file=sys.stderr)
        return 1

    print("OpenAPI 3.1 contract is valid.")
    print("Live web, Python and Go health payloads, structured service logs and actual BFF success/error/timeout responses match their contracts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
