# The Estimator

Turn a client brief into a reviewable software scope and explainable effort estimate. The Estimator extracts source-backed requirements, questions, risks, and team-fit findings, then builds a task-level estimate for a human to review.

**Demo:** [the-estimator-anduin-vu.zanyloach6.chatgpt.site](https://the-estimator-anduin-vu.zanyloach6.chatgpt.site) · **Source:** [RainyinSaiGon/the-estimator](https://github.com/RainyinSaiGon/the-estimator)

## What it does

1. Read pasted text or an uploaded project brief.
2. Review extracted requirements, evidence, questions, risks, and capability fit.
3. Confirm the scope and inspect a task-by-task estimate with its assumptions.
4. Save reviewed versions and compare delivery actuals with frozen estimates where eligible records are available.

The hosted demo runs the existing Sites application. The newer Next.js, Python, and Go service stack is a local preview and has not replaced the hosted runtime. Estimates are planning ranges; synthetic examples do not establish predictive accuracy.

## Run the local preview

Requires Docker Compose. From PowerShell:

```powershell
Copy-Item .env.example .env.local
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Put the generated value in `.env.local` as `BRIEF_SERVICE_TOKEN_SECRET` and set `BRIEF_SERVICE_TOKEN_KEY_ID=brief-local`. Then start the preview:

```powershell
docker compose --env-file .env.local up --build
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The default sample parser needs no OpenAI key; the internal service key above is still required. This preview is local and ephemeral by default. Use fictional or non-sensitive briefs. See [Local development](docs/local-development.md) for AI, private-workspace, and legacy-runtime setup.

## Repository layout

- `app/`, `components/`, `lib/`, `db/`, and `drizzle/` — existing Sites application.
- `apps/web/` — Next.js web app and backend-for-frontend.
- `services/identity-go/`, `services/estimator-go/`, and `services/brief-intelligence/` — identity, estimation/storage, and Python brief analysis services.
- `contracts/`, `evaluation/`, `scripts/`, and `docs/` — API contracts, evaluation tools, development scripts, and project documentation.

See the [repository guide](docs/repository-structure.md) and [documentation index](docs/README.md) for details.

## Checks

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run check:secrets
```

The contract check also needs the Python dependencies listed in `contracts/requirements.txt`; setup is in [Local development](docs/local-development.md). See [the demo script](docs/demo-script.md) for a walkthrough and [the evaluation guide](evaluation/README.md) for evidence and holdout limits.
