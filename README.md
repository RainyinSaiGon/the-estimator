# The Estimator

Turn incoming client requests and documents into reviewed scope, explainable task effort, and frozen estimates that can be compared with actual delivery. Configure the workflow for any company; Anduin is an optional reference profile.

**[Try the live app — no login](https://the-estimator-anduin-vu.zanyloach6.chatgpt.site/company-workspace)** · **[Watch the English pitch — 2:30](https://drive.google.com/file/d/1Q1cSkg2DO15L7w2CfSb-rGJT3wVm1J0d/view?usp=drivesdk)** · [Documentation](docs/README.md)

Open a sample brief or create your own. The public workspace is shared with other visitors; use fictional briefs and sample files only.

## What it does

1. **Intake and AI analysis:** receive a brief and attachments manually or through a signed form/CRM webhook. AI consults approved company knowledge, proposes tasks, and highlights product fit, missing information, and uncertainty.
2. **Scope review:** a person corrects findings, resolves questions, and confirms deliverables, exclusions, prerequisites, and completion criteria.
3. **Effort calculation:** calculate low, central, and high hours per task from company templates and eligible, independently approved training history. AI proposes work; the estimator calculates hours.
4. **Commitment and tracking:** freeze the approved baseline, track task progress and milestones, and record added scope separately. After delivery, independently review actuals and evaluate declared holdouts.

The workflow supports **6 request types**—demo inquiry, product setup, migration, integration, customization, and support—and **8 document formats**: PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, and EML. Image-only PDFs are flagged as needing OCR; OCR is not included. Company configuration, organization roles, signed webhooks, and read-only MCP support workflows beyond the Anduin reference.

## Verified demo

In our verified fictional sample, The Estimator broke a client request into **6 work packages**, with **53.6 central effort hours** and a **36.9–99.8-hour planning range**. It connects **4 stages**—intake and AI analysis, scope review, effort calculation, and commitment and tracking—and supports **6 request types** and **8 document formats**, including PDF, DOCX, XLSX, and CSV.

These figures demonstrate the workflow, not measured estimate accuracy or time savings. Real representative scoping cases and independently approved delivery outcomes remain pending. Synthetic examples and holdout outcomes are excluded from training-history adjustments.

Gmail polling is deferred on the live Site. [GitHub release and setup details](docs/sites-release.md) cover the hosted runtime; the Next.js, Python, and Go stack remains a separate deployment target.

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

This starts the basic service preview. For the complete AI company workspace at [http://localhost:3000/workspace](http://localhost:3000/workspace), configure OpenAI, first-party identity and private storage using [the setup guide](docs/company-workflow.md#run-locally). See [Local development](docs/local-development.md) for the `*:preview` and `*:sites` commands, keys, email verification, and local Sites runtime.

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
npm run build:preview
npm run build:sites
npm run check:secrets
```

The contract check also needs the Python dependencies listed in `contracts/requirements.txt`; setup is in [Local development](docs/local-development.md). See [the demo script](docs/demo-script.md) for a walkthrough and [the evaluation guide](evaluation/README.md) for evidence and holdout limits.
