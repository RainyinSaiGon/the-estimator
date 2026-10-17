# Preview API contracts

`v1/openapi.json` is the shared OpenAPI 3.1 contract for:

- `POST /api/v1/preview` in the Next.js BFF;
- `POST /v1/briefs/analyze` in the Python brief service;
- `POST /v1/estimates` in the Go estimator.

The paths and wire behavior remain owned by those services. The document records current casing (`initialAnswers`, `historyPolicy`, `referenceIds`), accepted answer and category values, parser behavior, input limits, and the known JSON error bodies. Python's service accepts an arbitrary parser string at the model boundary but currently implements only `sample`; other values return 503. The BFF accepts `sample` and `ai`, with `ai` returning 503 while AI is unconfigured. The Go service defaults a missing history policy to `demo` and accepts `demo` or `recorded`.

## Validation

From the repository root, install the documented service and contract-check dependencies in a Python 3.12+ virtual environment and run:

```powershell
npm run check:contracts
```

The checker validates the OpenAPI document and component schemas, builds and starts the actual Go and Python services on temporary loopback ports, sends a representative integration brief through both endpoints, and checks their success and error JSON against the shared schemas. It checks the BFF request and composed response schemas using those live service payloads. No external network calls, API keys, database, or production services are used. Go 1.26+ is required to build the estimator.

## Evolution rules

- Keep the route prefixes at `/api/v1` and `/v1` until a separately reviewed compatibility plan authorizes a breaking change.
- When endpoint behavior changes, update the owning handler, this contract, and the live-payload check together. Preserve request and response field casing.
- Add optional fields before requiring them. Treat narrowing an enum, removing/renaming a field, tightening an input limit, or changing a status/error shape as a compatibility change.
- Keep `openapi` at 3.1.0 for this contract line. Increment `info.version` for a published contract revision; create a new versioned contract directory for a new API major version.
- Do not infer hosted AI, persistence, authentication, or production data behavior from these local preview service contracts.
