# Preview API contracts

`v1/openapi.json` is the shared OpenAPI 3.1 contract for:

- `POST /api/v1/preview` in the Next.js BFF;
- `POST /v1/briefs/analyze` and `POST /v1/briefs/analyze-document` in the Python intake and analysis service;
- `POST /v1/estimates` and `POST /v1/estimates/general` in the Go estimator.

The paths and wire behavior remain owned by those services. The document records current casing (`initialAnswers`, `historyPolicy`, `referenceIds`), accepted answer values, parser behavior, input limits, and known JSON error bodies. The BFF accepts pasted JSON or bounded multipart document uploads and supports explicit `sample` or `ai` mode. Sample mode works without credentials. AI mode requires local server configuration and can return a provider or permissions error; it never silently switches to sample mode. The Go integration endpoint defaults a missing history policy to `demo` and accepts `demo` or `recorded`; the general-work endpoint uses explicitly uncalibrated complexity bands.

## Validation

From the repository root, install the documented service and contract-check dependencies in a Python 3.12+ virtual environment and run:

```powershell
npm run check:contracts
```

The checker validates the OpenAPI document and component schemas, builds and starts the actual Go and Python services on temporary loopback ports, sends a representative sample-parser integration brief, and checks success and error JSON against the shared schemas. It checks the BFF request and composed response schemas using those live service payloads. Its contract-check process removes any inherited AI key and does not call external providers. Go 1.26+ is required to build the estimator.

The same command validates each service's liveness and readiness responses and exercises the actual Next.js preview route with controlled upstream responses. It covers validation errors, unsupported AI mode, downstream Python/Go rejection, upstream unavailability, and separate timeouts at the Python and Go calls. The BFF route check uses Node's built-in web APIs and does not start a browser or web server.

## Evolution rules

- Keep the route prefixes at `/api/v1` and `/v1` until a separately reviewed compatibility plan authorizes a breaking change.
- When endpoint behavior changes, update the owning handler, this contract, and the live-payload check together. Preserve request and response field casing.
- Add optional fields before requiring them. Treat narrowing an enum, removing/renaming a field, tightening an input limit, or changing a status/error shape as a compatibility change.
- Keep `openapi` at 3.1.0 for this contract line. Increment `info.version` for a published contract revision; create a new versioned contract directory for a new API major version.
- Do not infer hosted AI, persistence, authentication, or production data behavior from these local preview service contracts.
