# Sites application and GitHub releases

The public application stays at <https://the-estimator-anduin-vu.zanyloach6.chatgpt.site>. Its company workflow is `/company-workspace`. GitHub is the source of truth for the complete Sites source tree.

## Release path

The **Sites release artifact** GitHub Actions workflow runs for pull requests and pushes to `main`. It checks types, evaluation invariants, and the compiled Worker against isolated local D1/R2. It builds the Cloudflare application with `npm run build:legacy` and uploads `sites-release-<commit>` with its GitHub commit and Git tree recorded in the archive. No production credential is available to CI.

After merging and successful CI, use the existing Sites source checkout and its short-lived source credential. Run `scripts/stage-sites-github-release.mjs <verified-main-sha>` from that clean checkout to stage the entire GitHub tree. Extract the matching Actions artifact there. The Sites source helper commits/pushes that tree and packages the checked build; save and publish it with the native Sites tools. Check deployment completion and `/release.json` against the merged GitHub commit. Do not copy individual application files between the repositories or rebuild a different revision.

Sites currently exposes public publication through its native tools, with short-lived source credentials. It does not provide this project a permanent public GitHub auto-deploy credential. CI build/artifact creation is automatic; final publication uses the Sites tool. This workflow does **not** claim unattended publication on every push.

The native Next.js/Go/Python/Postgres application in `apps/web` and `services` is a separate deployment target. Building a Sites archive does not deploy those processes. Existing D1 `projects` records remain intact alongside the company workflow tables.

## Live workflow

- Requests: AI-only intake, private PDF/DOCX/XLSX/CSV/text files, evidence references, editable reviewed scope, conditional required answers, task effort and immutable baselines.
- Knowledge and settings: administrator-approved source versions and configurable company-neutral fields, priorities, products, capabilities and task priors. Company intake JSON Schema is available from Connectors.
- Members: stable Site account IDs with administrator, estimator, reviewer and viewer roles. A new member signs in, shares their Site account ID, and an administrator adds that ID. Email addresses are not authorization identifiers.
- Connectors: signed demo-form/CRM intake with event deduplication; read-only MCP tools for approved knowledge and the intake schema. Gmail polling is deferred in the Sites implementation.
- Delivery: original task actuals, separate added scope, evidence and a designated different reviewer. The API rejects self-review, stale versions and changes/deletion of frozen records. Rejected actuals remain in history.
- Evaluation: split fixed at baseline freeze using `sha256(the-estimator-delivery-holdout-v1:<record-id>)[0] % 5 == 0`; holdout is 20%. Recorded and synthetic cohorts stay separate. Export JSONL from Evaluation and recompute with `python evaluation/evaluate_delivery_holdout.py --records <private-export>`.

This Sites engine uses configured task priors without learned adjustment. Base and adjusted predictions are identical. No delivery outcomes tune its policy or select its reported method. A small recorded cohort cannot establish accuracy or improvement. Issues #38 and #39 still require real representative independently approved evidence.

## Webhook activation

An administrator configures the external form/CRM sender; access to Anduin's submission system is not assumed. Enable the webhook in Connectors and copy the one-time secret into the sender's secret store. JSON fields are `submissionId`, `title`, `text`, `cohort` (`recorded` or `synthetic`), and optional `attachments` with `name` and `contentBase64`. Use a stable event ID for retries; changed content under the same ID returns 409.

Sign the exact UTF-8 bytes `timestamp + "." + rawBody` with HMAC-SHA256. Headers are `X-Workflow-Timestamp` (RFC3339 UTC), `X-Workflow-Signature` (hex), and `Content-Type: application/json`. Timestamps expire after five minutes. Rotation/revocation invalidates old secrets. Accepted requests start analysis automatically; provider failures stay visible and can be retried from Requests.

Webhook payloads are bounded to 5 MB, ten files, 2 MB each and 4 MB combined. DOCX, XLSX, CSV and text adapters run server-side. Webhook PDF originals are stored and flagged as incomplete; upload through Requests for page-aware extraction. Incomplete sources must be reconciled and acknowledged before scope confirmation. OCR and legacy DOC/XLS are not provided.

## Secrets, data and limits

Production `OPENAI_API_KEY` and `WORKFLOW_ENCRYPTION_KEY` belong only in Sites secret settings. The encryption key is 32 random bytes encoded as Base64 and protects webhook credentials with AES-GCM and company-bound authenticated data. Do not rotate it on an existing database without migrating encrypted credentials. MCP tokens are shown once and stored as hashes. Only approved company knowledge is returned by the MCP tools; tokens cannot write data.

Requests, originals and exports require an authorized organization identity. AI receives submitted text and extracted material only after explicit intake or a configured signed webhook. Private file keys are not public download URLs. Unfrozen requests and originals can be deleted from Requests. Frozen baselines, reviewed outcomes and audit history are retained; this prototype has no automatic retention purge. Private exports must stay outside Git. Limits are 50 owned organizations, 100 members, 200 requests and 200 knowledge versions per organization; latest 100 audit events are shown. Administrators must agree retention and deletion handling before storing customer data.

The existing account's OpenAI credential has a configured expiry; renew it in Sites secret settings before that expiry. A successful deployment does not prove a third-party form or MCP client is configured. An actual authorized client call verifies the connection; independent review requires a different real signed-in reviewer in production.
