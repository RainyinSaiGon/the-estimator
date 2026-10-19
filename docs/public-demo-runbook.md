# Public judge demo walkthrough

**Live app:** <https://the-estimator-anduin-vu.zanyloach6.chatgpt.site/company-workspace>  
**Source:** <https://github.com/RainyinSaiGon/the-estimator>

The Sites app is a shared, anonymous demo. It uses the configured OpenAI service for live analysis. Every request owned by the shared demo company is forced into the synthetic cohort, including requests from signed-in members and signed webhooks after public access is disabled. Use fictional names, systems, documents and hours only. Visitors can see and change shared requests, approved knowledge, settings and demo credentials.

## Ten-minute walkthrough

1. **Open the workspace without signing in.** Start at the live app link in a private browser window. The shared demo workspace contains a fictional CRM migration request; its status can change as visitors use the demo.
2. **Receive a request.** Open the seeded request or select **New request** and enter a fictional client brief. Optionally upload a fictional PDF, DOCX, XLSX or CSV file. Public requests are marked synthetic automatically.
3. **Show live AI analysis.** The configured OpenAI service reads the request and extracted document text, then checks approved company knowledge. Findings are suggestions with source evidence; the model does not calculate effort.
4. **Review the scope.** Read the provisional AI task breakdown under the summary, including verified source quotes or an explicit inference label. Correct or remove tasks, resolve questions, and review product fit, deliverables, exclusions, acceptance criteria, dependencies and owners. Confirm only a scope that makes sense for the fictional request.
5. **Calculate and freeze effort.** Calculate the per-task low, central and high hours from the versioned company task configuration and eligible approved training history. Review the sample counts and basis, then freeze the estimate as an immutable baseline.
6. **Show commitment and tracking.** In the frozen request, set each task's status, assignee, planned dates, milestones and blockers. Log any requested scope change separately; the saved entry does not alter the frozen baseline. Real delivery actuals require evidence and a different independent reviewer. Anonymous visitors share one identity, so this public demo cannot create a valid independent approval.
7. **Evaluate.** Open **Evaluate**. Recorded and synthetic cohorts remain separate. The public demo does not supply representative real delivery outcomes; a zero or small recorded sample is not evidence of accuracy or improvement.
8. **Explore company setup and integrations.** Open **Workspace settings**. Its sections group **Knowledge sources** and **Company settings**, **Members**, **Connectors**, and **Audit**. Add fictional approved knowledge and inspect the versioned configuration. Connectors can issue or revoke a shared-demo webhook secret and a read-only MCP token.

## Connector demonstration

- **Webhook:** In **Workspace settings → Integrations → Connectors**, select **Enable webhook** and copy the one-time demo secret. Send a fictional form payload signed with HMAC-SHA256 to the displayed company endpoint. Its analysis uses live AI, but the request is forced into the synthetic cohort. Never send a real customer submission or store the demo secret in production.
- **MCP:** Create a knowledge token and connect to the root `/mcp` endpoint. Call `company_list`, then provide the selected `companyId` to `knowledge_search`, `knowledge_fetch` or `company_intake_schema`. MCP is read-only. The shared token can be rotated or revoked by any anonymous visitor, so it is only for this demo.

The one-time webhook secret and MCP token are visible only after creation. Copy them into a temporary demo client if needed, then revoke them when finished. Any visitor can issue new credentials or invalidate the existing ones.

## What the demo demonstrates

- Real AI analysis with visible evidence and explicit human review.
- A company-neutral intake, knowledge and task configuration workflow.
- Deterministic task effort ranges and immutable frozen estimates.
- Synthetic cohort separation, reproducible holdout reporting and clear sample limits.
- Signed webhook intake and read-only MCP access.

It does **not** establish estimate accuracy, a real independent delivery review, a working connection to Anduin's private systems, or access to an external demo form's submissions. Do not invent delivery outcomes or present the synthetic workspace as customer data.
