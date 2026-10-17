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

```powershell
docker compose up --build
```

The sample estimate is ephemeral. The brief service extracts source passages with deterministic rules; the Go service returns task hours, ranges, and blockers using synthetic demonstration history. AI parsing is unconfigured, and no records are stored.

For a source-based local development setup, use Node 22.13+, Go 1.26+, and Python 3.12+ in three terminals:

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

Only the legacy application reads `OPENAI_API_KEY` from ignored `.env.local` and optionally `OPENAI_MODEL`. The new Next.js preview does not load the local key or call an AI provider. Hosted AI remains unconfigured; never commit credentials.

## Validate the preview API contracts

`contracts/v1/openapi.json` describes the existing Next.js preview route and Python and Go service APIs. It records their current JSON field names, parser/history-policy values, request limits, and error responses. Contract edits should follow the owning endpoint's current behavior; a wire change needs a separate compatibility decision and coordinated service update.

On Windows, from the repository root, install the Python service and contract-check dependencies in a virtual environment, then run the check:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r services/brief-intelligence/requirements.txt -r contracts/requirements.txt
npm run check:contracts
```

The check validates the OpenAPI document, builds and starts the local Go estimator and Python brief service on temporary loopback ports, and validates their real success and error JSON against the contract schemas. It also validates the BFF request and composed success payload. It needs Python 3.12+, Go 1.26+, and the listed local Python packages; it does not call external services or require credentials. See [contracts/README.md](contracts/README.md) for schema ownership and compatibility rules.

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
- `apps/web/app/`: native Next.js and Tailwind application, with `/estimate` and the preview BFF route.
- `services/brief-intelligence/`: Python FastAPI sample parser and source-linked scope extraction.
- `services/estimator-go/`: Go estimation engine and deterministic synthetic-history calibration.
- `compose.yaml`, `Dockerfile.web`, and service Dockerfiles: isolated local orchestration.
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
The official event page reviewed on 17 October 2026 gives a deadline of **19 October 2026, 23:59 Ho Chi Minh City time**. It requires a working hosted app and full source in a public GitHub repository. Full source is public at https://github.com/RainyinSaiGon/the-estimator. The public overview opens without signing in; each workspace requires sign-in and stores records by user. Hosted AI is intentionally unconfigured at the owner's request; use the labelled sample parser.

No real CRM credentials or client data are required to try the fictional scenario. This application estimates integration work; it does not execute CRM integrations or send client commitments.
