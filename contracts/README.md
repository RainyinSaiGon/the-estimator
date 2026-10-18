# Preview API contracts

The v1/identity-openapi.json document is the internal OpenAPI 3.1 contract for the first-party Go identity service. It covers account creation, sign-in, session validation/renewal/revocation, email verification and password recovery, and service health. It is an internal BFF/service contract; the browser must never call the Go identity API directly.

`v1/openapi.json` is the shared OpenAPI 3.1 contract for:

- `POST /api/v1/preview` in the Next.js BFF;
- `GET /api/v1/records/status`, `GET/POST/DELETE /api/v1/records`, and `GET/DELETE /api/v1/records/{recordId}` in the Next.js private-record BFF;
- `POST /v1/briefs/analyze` and `POST /v1/briefs/analyze-document` in the Python intake and analysis service;
- `POST /v1/estimates`, `POST /v1/estimates/general`, `GET /v1/records/status`, and the internal private-record routes in the Go estimator.

The paths and wire behavior remain owned by those services. The document records current casing (`initialAnswers`, `historyPolicy`, `referenceIds`), accepted answer values, parser behavior, input limits, and known JSON error bodies. The BFF accepts pasted JSON or bounded multipart document uploads and supports explicit `sample` or `ai` mode. Sample rules need no model-provider credential, but every BFF-to-Python call uses a short-lived bearer token with an exact analysis scope. AI mode additionally requires local provider configuration and can return a provider or permissions error; it never silently switches to sample mode. The Go integration endpoint defaults a missing history policy to `demo` and accepts `demo` or `recorded`; the general-work endpoint uses explicitly uncalibrated complexity bands. Private-record routes use first-party identity sessions and remain unavailable unless identity, service-token, PostgreSQL, and encryption settings are configured. Their BFF-to-Go JWT contract requires a single audience, stable account subject, exact per-operation scope, and no client-selected owner claim. Only verified accounts may receive a record service token.

Python trusts only its separate `BRIEF_SERVICE_TOKEN_*` key ring. The token audience is `the-estimator-brief-intelligence`, the caller is `the-estimator-web`, and the scope is either `briefs:analyze` or `briefs:analyze-document`. The web app does not forward browser cookies or bearer tokens. Python remains stateless: it receives only the submitted brief and capability inputs, has no identity or project database credentials, and never passes the service credential to an AI prompt. Health routes stay available if analysis authentication is unconfigured; analysis fails closed.

## Validation

From the repository root, install the documented service and contract-check dependencies in a Python 3.12+ virtual environment and run:

```powershell
npm run check:contracts
```

The checker validates the OpenAPI document and component schemas, builds and starts the actual Go and Python services on temporary loopback ports, sends a representative sample-parser integration brief, and checks success and error JSON against the shared schemas. It checks the BFF request and composed response schemas using those live service payloads. Its contract-check process removes any inherited AI key and does not call external providers. Go 1.26+ is required to build the estimator.

The same command validates each service's liveness and readiness responses and exercises the actual Next.js preview route with controlled upstream responses. It covers missing, expired, wrong-issuer, wrong-audience, wrong-scope, unknown-key, and invalid-signature Python credentials; BFF-side token creation and credential non-forwarding; validation errors; unsupported AI mode; downstream Python/Go rejection; upstream unavailability; and separate timeouts at the Python and Go calls. The BFF route check uses Node's built-in web APIs and does not start a browser or web server.

Go's two-account record-isolation integration test uses only a disposable database set through `RECORD_TEST_DATABASE_URL`; it proves that separate synthetic accounts cannot list, read, rename, or delete each other's records. The identity lifecycle integration test uses `IDENTITY_TEST_DATABASE_URL` to check session rotation, sign-out revocation, and expiry as well as recovery revocation.

## Evolution rules

- Keep the route prefixes at `/api/v1` and `/v1` until a separately reviewed compatibility plan authorizes a breaking change.
- When endpoint behavior changes, update the owning handler, this contract, and the live-payload check together. Preserve request and response field casing.
- Add optional fields before requiring them. Treat narrowing an enum, removing/renaming a field, tightening an input limit, or changing a status/error shape as a compatibility change.
- Keep `openapi` at 3.1.0 for this contract line. Increment `info.version` for a published contract revision; create a new versioned contract directory for a new API major version.
- Do not infer hosted AI, persistence, authentication, or production data behavior from these local preview service contracts.
