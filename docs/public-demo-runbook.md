# Public judge demo walkthrough

**Live app:** <https://the-estimator-anduin-vu.zanyloach6.chatgpt.site/company-workspace>  
**Source:** <https://github.com/RainyinSaiGon/the-estimator>

The Sites app is a shared, anonymous demo. It uses the configured OpenAI service for live analysis. Every request owned by the shared demo company is forced into the synthetic cohort, including requests from signed-in members and signed webhooks after public access is disabled. Use fictional names, systems, documents and hours only. Visitors can see and change shared requests, approved knowledge, settings and demo credentials.

## Ten-minute walkthrough

1. **Open the workspace without signing in.** Start at the live app link in a private browser window. The shared demo workspace contains a fictional CRM migration request; its status can change as visitors use the demo.
2. **Add a brief.** In **Client work**, choose **Open sample brief** when available, or **Add brief** and enter a fictional client request. Optionally upload a fictional PDF, DOCX, XLSX or CSV file. Public requests are marked synthetic automatically.
   The intake form explains shared visibility beside the fields and uploads. The main workspace has no demo banner or walkthrough panel.
3. **Show live AI analysis.** The configured OpenAI service reads the request and extracted document text, then checks approved company knowledge. Findings are suggestions with source evidence; the model does not calculate effort.
4. **Review the scope.** Read the provisional AI task breakdown under the summary, including verified source quotes or an explicit inference label. Correct or remove tasks, resolve questions, and review product fit, deliverables, exclusions, acceptance criteria, dependencies and owners. Confirm only a scope that makes sense for the fictional request.
5. **Calculate effort and commit the plan.** Calculate the per-task low, central and high hours from company task templates and eligible reviewed delivery history. Review the basis, then choose **Commit plan** to save the approved scope and estimate as an immutable baseline.
6. **Show commitment and tracking.** In the frozen request, set each task's status, assignee, planned dates, milestones and blockers. Log any requested scope change separately; the saved entry does not alter the frozen baseline. Real delivery actuals require evidence and a different independent reviewer. Anonymous visitors share one identity, so this public demo cannot create a valid independent approval.
7. **Review and learn.** Open **Review & results**. **Review queue** links to briefs awaiting analysis, a scope decision or a commitment. Its activity line and saved reviewer decisions describe observed workflow use. **Delivery results** explains how to collect independently approved actual hours and displays eligible real outcomes when available. Methodology and exports remain under a collapsed disclosure. Recorded and synthetic cohorts remain separate; workflow counts and demo outcomes cannot establish accuracy, time savings or improvement.
8. **Explore company setup and integrations.** Open **Workspace settings**. Its sections group **Knowledge sources** and **Company settings**, **Members**, **Connectors**, and **Audit**. Company settings contains workspace switching and creation, AI connectivity and settings revision details. Connectors can issue or revoke a shared-demo webhook secret and a read-only MCP token.

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
