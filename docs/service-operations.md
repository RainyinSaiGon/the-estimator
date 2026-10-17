# Local service operations

The native Next.js web app and the Go and Python APIs each expose `GET /health/live` and `GET /health/ready`. Liveness reports that the process is serving HTTP. Readiness reports whether that service can accept work; the web readiness route also checks that both preview API health routes respond. Compose publishes only the web app on loopback and waits for readiness before starting it.

## Request logs

The preview and health routes in the web app, plus all Python and Go HTTP routes, write one JSON request event with a timestamp, severity, service, event name, request ID, method, path, status, and duration in milliseconds. The web app forwards its validated `X-Request-ID` to the two APIs. Services accept only UUID-shaped or 32-character hexadecimal IDs, replace other values, and return the accepted ID in the response header.

Request logs omit bodies, briefs, query strings, headers, cookies, and credentials. Do not add those fields to request events. Python and Go application startup and shutdown messages use the same JSON format.

## Timeouts

- The Next.js BFF has a 10-second total deadline across brief analysis and estimation. Set `PREVIEW_TIMEOUT_MS` from 100 to 30,000 milliseconds to change it.
- Go defaults to an 8-second request deadline (`REQUEST_TIMEOUT`), with a maximum of 30 seconds, bounded header/body reads, response writes, a 60-second idle timeout, and a 10-second graceful shutdown.
- Python defaults to an 8-second ASGI request deadline (`REQUEST_TIMEOUT_SECONDS`, maximum 30), a 5-second keep-alive limit, and a 10-second graceful shutdown.
- Invalid timeout values fail closed at service startup or return the BFF's generic service-unavailable response. Error messages never echo configured values.

## Configuration and credentials

Use each service `.env.example` as a reference for local process variables. Services consume process environment only and do not search for or load arbitrary env files. Next.js follows its documented local env-file behavior within `apps/web`. Docker Compose passes non-secret URLs, bind addresses, ports, and timeout settings explicitly; it does not mount local env files or forward credentials. Docker build stages must not receive credentials through `ARG`, `ENV`, or copied env files. The Docker ignore rules exclude local env files throughout the monorepo.

The current Go estimator and Python sample parser need no credentials. The optional OpenAI key shown in the root `.env.example` is for the legacy Site only; hosted AI remains disabled. If a future server-side provider integration is approved, inject its secret from the runtime's secret store or an ignored local env file, read it only in server code, never use a `NEXT_PUBLIC_`/`VITE_` name, never send it to another service unless required, and never include it in logs or build artifacts.

No production host, routing, or persisted data is changed by this local Compose setup.
