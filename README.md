# The Estimator

A working scoping and effort-estimation workspace for CRM/API integrations and CSV migrations, built for Anduin's **Agent in the Shell** challenge.

Client brief → source-grounded scope → clarifying questions → task estimate → reviewed baseline → actual hours → calibration of comparable future work.

## Existing deployed application (legacy runtime)

The current public Site is still the original application. It remains available on this branch while the Next.js and microservice migration is reviewed; this first slice does not replace its hosted runtime or stored workspaces.

### Existing workflow

- Live OpenAI structured extraction with schema validation and verified source passages.
- An explicitly labelled sample parser that runs without API usage.
- Editable scope inclusions, five effort drivers, review notes and heuristic planning ranges.
- Task-level explanations, comparable historical references and immutable estimate snapshots.
- Actual original-scope hours, separate additions and a preview of the next comparable estimate.
- Persistent user-scoped D1 storage, stale-update detection and authenticated mutations.
- Markdown estimate export and JSON workspace export.
- Questions ranked by baseline blockers and deterministic effort sensitivity, with source context and a copyable client clarification pack.
- Recorded-only or demonstration history policies, reference-match explanations, and every contributing task observation.
- Frozen base/adjusted prediction errors, bias, and descriptive range coverage in separate recorded and synthetic cohorts.
- Baseline-to-baseline/draft comparisons, replacement reasons, and exports for a selected saved version.

Eight initial historical projects are **synthetic demonstration examples**. The illustrative-hours button marks its output as synthetic too. A changed estimate demonstrates the learning mechanism; predictive accuracy improvement has not been established.

## Run the new local service slice
Use Docker Compose, which builds and starts the Next.js web app, Python brief service, and Go estimator service. Only the web app is published, bound to loopback at `http://127.0.0.1:3000/`.

Before starting Compose, add a distinct internal Python service key and key ID to the ignored root `.env.local`. The same service key is shared only by the server-side BFF and Python; keep it different from the Go `SERVICE_TOKEN_SECRET` and all identity/storage keys. Generate a local value without sharing it:

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Set the output as `BRIEF_SERVICE_TOKEN_SECRET`, set `BRIEF_SERVICE_TOKEN_KEY_ID=brief-local-2026-10`, then start the preview:

```powershell
docker compose --env-file .env.local up --build
```

The preview accepts pasted text and bounded PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, JSON, and EML files. The Python service extracts text locally. The default sample mode uses deterministic rules and needs no model-provider key; the internal BFF-to-Python service key is required for all analysis requests. The Go service returns either integration estimates with labelled synthetic references or general-work planning bands explicitly marked uncalibrated. By default the local preview is ephemeral and stores no request or estimate records.

### First-party identity and private workspaces

The local identity service owns account credentials and revocable sessions. The Next.js BFF stores opaque session tokens in an HttpOnly, SameSite cookie; PostgreSQL is not published to the host. Private-record requests use a short-lived service token with the first-party account UUID, and Go applies owner isolation before reading, writing, or deleting encrypted snapshots. Python uses its own audience- and scope-limited token; it has no identity/project database credentials or private-record permissions.

To enable the local private workspace, copy the placeholders from `compose.private-records.env.example` into the ignored root `.env.local`, generate distinct random values for every password/key, and preserve any existing `OPENAI_API_KEY` line. Start all three overlays under a unique project name:

```powershell
docker compose -p estimator-private-preview --env-file .env.local -f compose.yaml -f compose.identity.yaml -f compose.private-records.yaml up --build
```

Only the web app is published on loopback. `WEB_PORT` defaults to `3002` in this example so it can run beside the standard preview. Each saved version keeps the original suggestion, reviewed scope, source, uploaded original file (when present), and confirmed estimate as one AES-256-GCM encrypted snapshot. Titles and source content are encrypted; database metadata is limited to random IDs, a keyed owner index, timestamps, and schema version. Version 1 reserves a nullable delivery outcome for the later delivery-history phase. Users can open, delete one estimate, or delete their workspace; expired records are hidden immediately and purged every six hours. Retention defaults to 90 days and is bounded to 1–3650 days.

The local legacy provider migration path has been removed. The single old local encrypted record was deleted at the owner’s request; no hosted Site or D1 data was changed. Registration creates an unverified account without a usable password or session. The mailbox owner sets the initial password while completing the verification link; only then is a session created. Email recovery is implemented, and the BFF plus Go record service both require a verified email before private-record access. Recovery tokens are single-use, expire after 30 minutes, and a successful password reset revokes every session. Email delivery is disabled by default; in that mode email actions fail closed and private records remain unavailable. This prototype does not import Sites/D1 workspaces, provide MFA, or change production routing or the judge URL. Do not use real client data or rotate the content/index keys without a planned migration.

To exercise verification and recovery locally, add a distinct `MAILPIT_SMTP_PASSWORD` to the ignored root `.env.local`, then generate a local certificate and run the SMTP overlay:

```powershell
.\scripts\generate-mailpit-certificate.ps1
docker compose -p estimator-private-preview --env-file .env.local -f compose.yaml -f compose.identity.yaml -f compose.private-records.yaml -f compose.identity-mailpit.yaml up --build
```

The optional Mailpit inbox is available at `http://127.0.0.1:8025`. The SMTP service is internal to Compose, requires STARTTLS, and its certificate is verified by the identity service using the local certificate authority file. Generated certificate and key files live under ignored `.local/mailpit/`; do not commit them. The default preview never delivers real email.

For the lifecycle integration check, use a disposable PostgreSQL database, set `IDENTITY_TEST_DATABASE_URL` for the test process, and run `go test ./cmd/identity` from `services/identity-go`. The test creates synthetic accounts, exercises verification, recovery, expiry, reuse, throttling, response parity, and session revocation, then deletes only those synthetic accounts.

For a local AI run, point Compose at an ignored file that contains `OPENAI_API_KEY` (the root `.env.local` is the local configuration file when present). The key is passed only to the Python service at runtime; it is not copied into the web container or image:

```powershell
docker compose --env-file .env.local up --build
```

The AI option runs the OpenAI Agents API with scope, delivery-risk, and capability specialists, followed by a source-evidence check. The user must select AI mode; provider errors do not switch to sample mode. The request text and any supplied team profile are sent to OpenAI for that run. The app deletes its agent session after completion, but this does not promise zero provider-side retention; use fictional or non-sensitive material in this local prototype. Reviewers can edit or remove findings, and the estimator is called only after they explicitly confirm the scope. Hosted AI and the public Site remain unchanged.

For a source-based local development setup, use Node 22.13+, Go 1.26+, and Python 3.12+ in three terminals. The Next.js BFF and Python process need the matching `BRIEF_SERVICE_TOKEN_SECRET` and `BRIEF_SERVICE_TOKEN_KEY_ID` values from the ignored environment file; the key must not be the Go record-service key.

```powershell
go run ./services/estimator-go/cmd/estimator
```

```powershell
python services/brief-intelligence/main.py
```

```powershell
npm ci
npm run dev
```

The root `dev`, `build`, and `start` scripts run the native Next.js app in `apps/web`. The previous Sites implementation remains available while this migration is reviewed:

```powershell
npm run build:legacy
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mean_jubilee.sql
npm run dev:legacy
```

Apply that initial SQL file once per new local legacy database. It is already applied in the current workspace. For future schema changes, run `npm run db:generate` and apply only new migration files. Local legacy data lives in ignored `.wrangler/state`; production storage is separate. `npm run start:legacy` serves a previously built legacy worker.

The legacy development server opens on `http://127.0.0.1:5173/`. The portable development server provides its documented local test identity. Production authentication is owned by Sites; records are scoped to the authenticated user's ID. The new preview does not use that persistence or authentication path.

The Python service reads `OPENAI_API_KEY` and optional `AGENT_MODEL` from its process environment. The web app never reads or receives the provider key. The legacy application continues to use `OPENAI_API_KEY` and optional `OPENAI_MODEL` through its own runtime. Never commit credentials or place them in browser-visible variables.

## Validate the preview API contracts

`contracts/v1/openapi.json` describes the existing Next.js preview route and Python and Go service APIs. It records their current JSON field names, parser/history-policy values, request limits, and error responses. Contract edits should follow the owning endpoint's current behavior; a wire change needs a separate compatibility decision and coordinated service update.

On Windows, from the repository root, install the Python service and contract-check dependencies in a virtual environment, then run the check:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r services/brief-intelligence/requirements.txt -r contracts/requirements.txt
npm run check:contracts
```

The check validates the OpenAPI document, builds and starts the local Go estimator and Python brief service on temporary loopback ports, and validates their real success and error JSON against the contract schemas. It checks that analysis does not call Go, scope confirmation is required, source quotes are verified before estimation, and both integration and general-work estimates follow their documented contracts. It needs Python 3.12+, Go 1.26+, and the listed local Python packages; it does not call external services or require credentials. See [contracts/README.md](contracts/README.md) for schema ownership and compatibility rules.

If a Windows package-manager shim fails, these direct entrypoints use the same project scripts:

```powershell
node scripts/run-framework.mjs build
node scripts/run-framework.mjs dev
```

## Existing application checks

These existing checks cover the TypeScript/legacy workflow. The new web app's `npm run build` is the native Next.js production build.

```powershell
npm test
npm run typecheck
npm run build
npm run build:legacy
npm run check:secrets
npm run check:contracts
```

Unit checks exercise evidence matching, missing information, deterministic estimates, scope exclusions, history adjustments, sparse-data uncertainty, baseline changes and invalid actual hours. Browser checks exercise the full stored workflow. See `docs/demo-script.md` for a reproducible walkthrough.

## How the numbers work
The language model extracts requirements and confirmed facts, not hours. A separate numeric engine starts from explicit task base hours and adjusts them for direction, API readiness, mapping, quality and volume.

Historical matches use weighted feature similarity of at least 0.45. Each task uses a median actual-to-base effort ratio, shrunk toward 1 with four prior observations. Individual ratios are bounded between 0.35 and 3. Unknowns, sparse history and observed spread widen a **heuristic planning range**, not a statistical confidence interval. Original-scope hours enter calibration; added scope does not. A project is excluded from its own current estimate.

## Source map
- `apps/web/app/`: native Next.js and Tailwind application, with `/sign-in`, `/account`, `/estimate`, first-party auth routes, and private-record BFF routes.
- `services/brief-intelligence/`: Python FastAPI document extraction, sample parser, and optional specialist-agent analysis.
- `services/estimator-go/`: Go integration estimator, first-party identity service, uncalibrated general-work planning, and the encrypted private-record store.
- `compose.yaml`, `compose.identity.yaml`, `compose.private-records.yaml`, `Dockerfile.web`, and service Dockerfiles: isolated local orchestration; identity and private databases are opt-in.
- `docs/service-operations.md`: health checks, structured request logs, timeout defaults and secret-loading rules.
- `docs/adr/0001-next-go-python-first-slice.md`: service ownership, boundaries and migration constraints.
- `app/home-screen.tsx`: interactive product overview and sample entry points.
- `app/workspace-app.tsx`: shared navigation, the three-stage workspace and project history.
- `app/globals.css`: responsive UI and shared visual system; see `docs/ui-design.md`.
- `app/api/workspace/route.ts`: authenticated persistence, review and delivery lifecycle.
- `lib/brief-ai.ts`: server-only structured extraction.
- `lib/evidence.ts`: source-passage matching.
- `lib/estimator.ts`: deterministic estimation and calibration.
- `lib/estimator-data.ts`: task assumptions and labelled fictional reference projects.
- `lib/clarifications.ts`: source support, question ordering, option sensitivity and client question packs.
- `lib/learning.ts`: prediction-error summaries from frozen baselines and original-scope actuals.
- `lib/baselines.ts`: stored-version comparison and escaped Markdown exports.
- `lib/project-record.ts`: version-2 live-field defaults without rewriting legacy snapshots.
- `db/schema.ts` and `drizzle/`: D1 schema and migrations.
- `docs/mvp-spec.md`: scope, assumptions, acceptance criteria and remaining decisions.

## Submission status
The official event page reviewed on 17 October 2026 gives a deadline of **19 October 2026, 23:59 Ho Chi Minh City time**. It requires a working hosted app and full source in a public GitHub repository. Full source is public at https://github.com/RainyinSaiGon/the-estimator. The existing hosted Site remains the judge-facing app, with private authenticated workspaces. The new multi-service preview is local-only and ephemeral; its optional AI key is not configured in the hosted runtime. Use the labelled sample path for the hosted walkthrough.

No real CRM credentials or client data are required to try the fictional scenario. This application estimates integration work; it does not execute CRM integrations or send client commitments.
