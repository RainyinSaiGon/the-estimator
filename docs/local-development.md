# Local development

For the AI company workspace, start with the [company workflow guide](company-workflow.md). It uses the identity/private-storage overlays below and opens at `/workspace`. The older `/estimate` service preview retains its sample parser for compatibility.

## Default service preview

Requires Docker Compose. Copy the example configuration and set the internal BFF-to-Python credential in the ignored `.env.local` file:

```powershell
Copy-Item .env.example .env.local
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Set `BRIEF_SERVICE_TOKEN_SECRET` to the generated value and set `BRIEF_SERVICE_TOKEN_KEY_ID` to a short identifier, such as `brief-local`. Keep this key different from `SERVICE_TOKEN_SECRET` and every identity or storage key. Start the preview:

```powershell
docker compose --env-file .env.local up --build
```

Open `http://127.0.0.1:3000`. Only the web app is published, bound to loopback. The deterministic sample parser needs no provider key; the BFF-to-Python key is required for all analysis. By default, the preview is ephemeral and stores no estimates or briefs.

## Optional AI analysis

Set `OPENAI_API_KEY` and, optionally, `AGENT_MODEL` in `.env.local`, then start the same Compose command. The user must choose AI mode. Brief text and any team profile are sent to the provider for that run; use fictional or non-sensitive material. Provider errors do not fall back to sample mode. The Python service deletes its agent session after completion, but this does not promise zero provider-side retention. The web app does not receive the provider key.

## Optional private workspace

Set the identity and private-record placeholders from `compose.private-records.env.example` in `.env.local`. Generate a different random value for every password and key, preserving any existing `OPENAI_API_KEY` and BFF-to-Python values. Set `WEB_PORT=3002` if the default preview is running on port 3000. Then start the identity and private-record overlays with a unique Compose project name:

```powershell
docker compose -p estimator-private-preview --env-file .env.local -f compose.yaml -f compose.identity.yaml -f compose.private-records.yaml up --build
```

`WEB_PORT` defaults to `3002` in the example so the private preview can run beside the default one. PostgreSQL remains internal. Saved snapshots encrypt the source and estimate; titles are encrypted separately. Retention defaults to 90 days and is bounded to 1–3650 days. The preview does not import Sites/D1 workspaces, provide MFA, or change production routing.

Email verification and recovery are disabled unless the optional Mailpit overlay is configured. Set a distinct `MAILPIT_SMTP_PASSWORD`, generate its local certificate, and start the additional overlay:

```powershell
.\scripts\generate-mailpit-certificate.ps1
docker compose -p estimator-private-preview --env-file .env.local -f compose.yaml -f compose.identity.yaml -f compose.private-records.yaml -f compose.identity-mailpit.yaml up --build
```

The Mailpit inbox is at `http://127.0.0.1:8025`. Generated certificate files are kept under ignored `.local/mailpit/`; the default preview never sends real email.

For account lifecycle and local identity details, see the [identity service guide](../services/identity-go/README.md) and [identity threat model](identity-threat-model.md).

## Source-based development

Use Node 22.13+, Go 1.26+, and Python 3.12+. Configure the BFF-to-Python key above, then run the services in separate terminals from the repository root:

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

The root `dev`, `build`, and `start` commands use the Next.js app in `apps/web`.

## Existing Sites app

The Sites app and its D1 storage remain separate from the new preview. To run its local worker:

```powershell
npm run build:legacy
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mean_jubilee.sql
npm run dev:legacy
```

Apply the initial migration once per new local legacy database. Future schema changes use `npm run db:generate` and only the new migration files. Local data is stored in ignored `.wrangler/state`; production storage is separate. The legacy worker opens at `http://127.0.0.1:5173`. `npm run start:legacy` serves a previously built worker.

## Validation

```powershell
npm test
npm run typecheck
npm run build
npm run build:legacy
npm run check:secrets
```

The contract check needs the Python dependencies in `services/brief-intelligence/requirements.txt` and `contracts/requirements.txt`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r services/brief-intelligence/requirements.txt -r contracts/requirements.txt
npm run check:contracts
```

It validates the OpenAPI files and exercises local Go, Python, and BFF responses. It needs Go 1.26+, Python 3.12+, and the listed packages; it does not call external services. If a Windows package-manager shim fails, run `node scripts/run-framework.mjs build` or `node scripts/run-framework.mjs dev` directly.
