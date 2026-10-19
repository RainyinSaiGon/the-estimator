# The Estimator

Turn incoming client requests and documents into reviewed scope, explainable task effort, and frozen estimates that can be compared with actual delivery. Configure the workflow for any company; Anduin is an optional reference profile.

**Demo:** [the-estimator-anduin-vu.zanyloach6.chatgpt.site](https://the-estimator-anduin-vu.zanyloach6.chatgpt.site) · **Source:** [RainyinSaiGon/the-estimator](https://github.com/RainyinSaiGon/the-estimator)

## What it does

1. Receive requests through uploads, an authorized Gmail inbox, or a signed form/CRM webhook.
2. Use AI to extract evidence, consult approved company knowledge, and identify product fit, gaps, and questions.
3. Review scope and task effort, then freeze the baseline.
4. Independently review actual delivery and evaluate declared holdouts, keeping synthetic data separate.

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

This starts the basic service preview. For the complete AI company workspace at [http://localhost:3000/workspace](http://localhost:3000/workspace), configure OpenAI, first-party identity and private storage using [the setup guide](docs/company-workflow.md#run-locally). See [Local development](docs/local-development.md) for keys, email verification and the legacy runtime.

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
