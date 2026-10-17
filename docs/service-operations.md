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

## Optional private records

The base Compose file leaves private records disabled. To enable the local `compose.private-records.yaml` overlay, configure a generic OIDC issuer, client ID/secret, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` for the web service. Register `http://localhost:3000/api/auth/callback/oidc` with the chosen local-development client. `OIDC_DISCOVERY_URL` is optional; when omitted, the web app requests `/.well-known/openid-configuration` beneath the configured issuer. OIDC issuer, discovery, and application URLs must use HTTPS except for loopback development.

The Go service requires `DATABASE_URL`, `SERVICE_TOKEN_SECRET`, `CLIENT_CONTENT_KEY`, and `IDENTITY_INDEX_KEY` together. Use distinct random values. `SERVICE_TOKEN_SECRET` must contain at least 32 bytes. Each encryption/index key must be a base64 encoding of 32 random bytes. For local setup, `openssl rand -base64 32` can generate each of those three values; use a separate `openssl rand -hex 32` value for `POSTGRES_PASSWORD` so the local database URL needs no special-character escaping. `NEXTAUTH_SECRET` should also be independently generated with `openssl rand -base64 32`. `IDENTITY_INDEX_KEY` stays stable for the lifetime of the account mapping; `CLIENT_CONTENT_KEY` stays stable for decrypting saved snapshots. Key rotation requires a reviewed data re-encryption or index-rebuild procedure. `RECORD_RETENTION_DAYS` defaults to 90 and must be between 1 and 3650. The Go service applies its initial idempotent private-record schema at startup only after all storage settings validate and PostgreSQL is reachable.

Private record ownership uses an HMAC of the validated OIDC issuer and subject; raw issuer, subject, email, and title are not stored as plaintext in PostgreSQL. The Next.js BFF keeps OIDC session material server-side and forwards only a short-lived HS256 service token with an audience and random token ID. Go checks its algorithm, signature, issuer, audience, subject, OIDC issuer, issue time, and expiry before every list/read/create/delete. The database stores only an internal random account UUID, pseudonymous owner index, random record UUID, schema version, timestamps, nonce, and ciphertext. The full snapshot (including title, uploaded original file bytes when present, and extracted client source) is encrypted using AES-256-GCM with account and record identifiers as additional authenticated data. Titles have a separate encrypted column so listing records does not decrypt whole uploaded files. Version 1 reserves a null delivery outcome for later delivery-history work. Go alone receives PostgreSQL and content-encryption settings; Python remains stateless.

Expired records are excluded from reads immediately. A six-hour cleanup removes expired ciphertext and then removes account-index rows that no longer own records. Individual deletion and whole-workspace deletion are owner-scoped. Request logs contain only route, request ID, timing, and response status; never add source text, titles, session cookies, tokens, or credentials to logs.

Provider credentials intentionally remain unconfigured. The code path and local Compose overlay are present for later configuration, but owner-isolation against two actual OIDC users, retention behavior against PostgreSQL, and provider-specific claim/discovery compatibility have not been exercised. Production deployment, Sites identity linking, D1 import, and traffic cutover remain separate gates.
