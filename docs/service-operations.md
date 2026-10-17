# Local service operations

The native Next.js web app and the Go and Python APIs each expose `GET /health/live` and `GET /health/ready`. Liveness reports that the process is serving HTTP. Readiness reports whether that service can accept work; the web readiness route also checks that both preview API health routes respond. Compose publishes only the web app on loopback and waits for readiness before starting it.

## Request logs

The preview and health routes in the web app, plus all Python and Go HTTP routes, write one JSON request event with a timestamp, severity, service, event name, request ID, method, path, status, and duration in milliseconds. The web app forwards its validated `X-Request-ID` to the two APIs. Services accept only UUID-shaped or 32-character hexadecimal IDs, replace other values, and return the accepted ID in the response header.

Request logs omit bodies, briefs, query strings, headers, cookies, and credentials. Do not add those fields to request events. Python and Go application startup and shutdown messages use the same JSON format.

## Timeouts

- The Next.js BFF has a 50-second total deadline across brief analysis and estimation. Set `PREVIEW_TIMEOUT_MS` from 100 to 60,000 milliseconds to change it. The longer default allows explicitly selected model-backed analysis to finish.
- Go defaults to an 8-second request deadline (`REQUEST_TIMEOUT`), with a maximum of 30 seconds, bounded header/body reads, response writes, a 60-second idle timeout, and a 10-second graceful shutdown.
- Python defaults to a 40-second ASGI request deadline (`REQUEST_TIMEOUT_SECONDS`, maximum 45), a 5-second keep-alive limit, and a 10-second graceful shutdown. The model client also has a finite request timeout.
- Invalid timeout values fail closed at service startup or return the BFF's generic service-unavailable response. Error messages never echo configured values.

## Configuration and credentials

Use each service `.env.example` as a reference for local process variables. Services consume process environment only and do not search for or load arbitrary env files. Next.js follows its documented local env-file behavior within `apps/web`. For local AI only, Docker Compose may read `OPENAI_API_KEY` from an explicitly selected ignored env file and inject it into the Python service at runtime. It is not mounted as a file, passed to the web service, or included in a build stage. Docker build stages must not receive credentials through `ARG`, `ENV`, or copied env files. The Docker ignore rules exclude local env files throughout the monorepo.

Sample mode and the Go estimator need no credentials. The optional local agent mode requires `OPENAI_API_KEY` and `AGENT_MODEL` in the Python service environment. It sends the submitted text and capability profile to OpenAI only when the user selects AI mode. The brief service requests deletion of the completed agent session; this is not a zero-retention guarantee. Do not use confidential client materials in this local preview. Hosted AI remains disabled, and the provider key is never read by browser code, logged, or committed.

No production host, routing, or persisted data is changed by this local Compose setup.
