# The Estimator

A working scoping and effort-estimation workspace for CRM/API integrations and CSV migrations, built for Anduin's **Agent in the Shell** challenge.

Client brief → source-grounded scope → clarifying questions → task estimate → reviewed baseline → actual hours → calibration of comparable future work.

## What works
- Live OpenAI structured extraction with schema validation and verified source passages.
- An explicitly labelled sample parser that runs without API usage.
- Editable scope inclusions, five effort drivers, review notes and heuristic planning ranges.
- Task-level explanations, comparable historical references and immutable estimate snapshots.
- Actual original-scope hours, separate additions and a preview of the next comparable estimate.
- Persistent user-scoped D1 storage, stale-update detection and authenticated mutations.
- Markdown estimate export and JSON workspace export.

Eight initial historical projects are **synthetic demonstration examples**. The illustrative-hours button marks its output as synthetic too. A changed estimate demonstrates the learning mechanism; predictive accuracy improvement has not been established.

## Run locally
Use Node 22.13+ (Node 24 was used during development).

```powershell
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mean_jubilee.sql
npm run dev
```

Apply that initial SQL file **once per new local database**. It is already applied in the current workspace. For future schema changes, run `npm run db:generate` and apply only new migration files. Local data lives in ignored `.wrangler/state`; production storage is separate.

Open the printed loopback URL, normally `http://127.0.0.1:5173/`. The portable development server provides its documented local test identity. Production authentication is owned by Sites; records are scoped to the authenticated user's ID.

For live analysis, the server reads `OPENAI_API_KEY` from the ignored `.env.local` file and optionally `OPENAI_MODEL` (default `gpt-5.4-mini`). Use the secure API key setup flow; do not commit credentials. The key selected during setup has a 24-hour lifetime. The example file lists names only. Hosted runtime credentials are configured separately from local files.

If a Windows package-manager shim fails, these direct entrypoints use the same project scripts:

```powershell
node scripts/run-framework.mjs build
node scripts/run-framework.mjs dev
```

## Checks
```powershell
npm test
npm run typecheck
npm run build
npm run check:secrets
```

Unit checks exercise evidence matching, missing information, deterministic estimates, scope exclusions, history adjustments, sparse-data uncertainty, baseline changes and invalid actual hours. Browser checks exercise the full stored workflow. See `docs/demo-script.md` for a reproducible walkthrough.

## How the numbers work
The language model extracts requirements and confirmed facts, not hours. A separate numeric engine starts from explicit task base hours and adjusts them for direction, API readiness, mapping, quality and volume.

Historical matches use weighted feature similarity of at least 0.45. Each task uses a median actual-to-base effort ratio, shrunk toward 1 with four prior observations. Individual ratios are bounded between 0.35 and 3. Unknowns, sparse history and observed spread widen a **heuristic planning range**, not a statistical confidence interval. Original-scope hours enter calibration; added scope does not. A project is excluded from its own current estimate.

## Source map
- `app/home-screen.tsx`: interactive product overview and sample entry points.
- `app/workspace-app.tsx`: shared navigation, the three-stage workspace and project history.
- `app/globals.css`: responsive UI and shared visual system; see `docs/ui-design.md`.
- `app/api/workspace/route.ts`: authenticated persistence, review and delivery lifecycle.
- `lib/brief-ai.ts`: server-only structured extraction.
- `lib/evidence.ts`: source-passage matching.
- `lib/estimator.ts`: deterministic estimation and calibration.
- `lib/estimator-data.ts`: task assumptions and labelled fictional reference projects.
- `db/schema.ts` and `drizzle/`: D1 schema and migrations.
- `docs/mvp-spec.md`: scope, assumptions, acceptance criteria and remaining decisions.

## Submission status
The official event page read on 14 October 2026 gives a deadline of **18 October 2026, 23:59 Ho Chi Minh City time**. It requires a working hosted app and full source in a public GitHub repository. A private Sites preview is for owner review; public judge access and public GitHub delivery still need to be finalized.

No real CRM credentials or client data are required to try the fictional scenario. This application estimates integration work; it does not execute CRM integrations or send client commitments.
