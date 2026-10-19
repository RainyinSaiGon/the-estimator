# Legacy single-estimate demonstration

> The live public Site uses the company request workflow, not the older single-estimate screens described below. Use the current [public demo walkthrough](public-demo-runbook.md) when presenting the hosted Site.

Use a fictional CRM request; the example is not real client data. Start with the workspace's **Try a sample** action. It explicitly uses a sample parser. To demonstrate live AI instead, choose **New request**, insert the sample text and choose **AI analysis** on a configured server.

1. Explain the problem: a delivery lead has a client request but lacks a consistent way to scope and estimate it.
2. Analyze the sample. Show original passages next to the extracted requirements. The source says an API exists but does not establish access/readiness or synchronization direction.
3. Confirm one-way sync, documented API access and standard field mapping. Leave the extracted volume and mixed quality as given. Save clarifications. Explain how the estimate responds to input changes.
4. Open **Effort estimate**. Show the tasks, base hours, adjustment from comparable history and heuristic range. The reference library is clearly labelled synthetic.
5. Confirm human review and save a baseline. Show the saved version and export the estimate.
6. Open **Delivery & learning**. Use **Fill illustrative hours** for the demo, which marks them synthetic. Add 6 additional-scope hours and explain an added custom lookup; original-scope task hours remain separate.
7. Record delivery. Show the original estimate preserved and the next-estimate preview using the new historical result.
8. Reload the page to demonstrate server persistence. Open project history and explain synthetic versus user-recorded results.
9. Explain architecture: validated AI extraction, a reproducible numeric engine, immutable baseline snapshots and user-scoped D1 records.
10. State the evidence limit: the prototype demonstrates scoping and calibration. Accuracy claims require independent representative project outcomes and an evaluation that keeps test cases out of calibration.

## Review and learning walkthrough

1. Choose **Try a sample**. Keep **Sample parser** and **Include synthetic demonstration history** selected; no AI API call is required.
2. Under **Ask what changes the work**, inspect the two baseline blockers before the other unknowns. Expand possible answers to see isolated whole-project effort sensitivity. Copy or download the unresolved questions, and use **Show in brief** to see the source context.
3. Confirm one-way synchronization, documented API access, and standard mapping; add a fictional confirmation note. Choose **Recorded deliveries only**. With no eligible real history, the adjustment is zero and the UI explains that base assumptions are used. Save clarifications.
4. Review and save baseline v1. Change the direction to two-way, add an updated review note, and switch to demonstration history. Save clarifications. The comparison identifies the driver, notes, policy and reference changes; v1 keeps its stored hours.
5. Explain why the agreement changed, confirm review and save v2. Compare v1 with v2 and export v1. Its original hours and assumptions remain in the file. Delivery stays blocked while the current reviewed scope differs from the latest baseline.
6. Fill illustrative delivery hours, add 6 hours of fictional extra scope with an explanation, and record the result. The illustrative button marks the outcome synthetic.
7. In **Project history**, open the learning report. Recorded deliveries report insufficient evidence when none exist. The synthetic cohort reports frozen base/adjusted errors, signed bias and observed range coverage. Added-scope hours do not enter these metrics.
8. Explain that the built-in reference library has actual/base examples but no independent frozen prediction record, so those eight rows alone are not an accuracy evaluation cohort.

## Before submission
- The hosted public Site uses the configured OpenAI service for live analysis. Its anonymous workspace is shared; use fictional requests and files only.
- Open the [public company workspace](https://the-estimator-anduin-vu.zanyloach6.chatgpt.site/company-workspace) in a signed-out browser and confirm it opens without login.
- The separate local estimate app may show its sample parser; do not describe that as the hosted Sites workflow.
- Submit https://github.com/RainyinSaiGon/the-estimator as the public source repository.
- Check an unfamiliar brief, source evidence, failed-provider behavior and the complete delivery cycle once more after any material changes.

## Local agent-led preview

The Next.js/Python/Go preview is a separate local architecture slice, not the hosted judge workspace. Follow [Local development](local-development.md#default-service-preview) to start it. The base Compose setup keeps requests ephemeral; [the optional private-workspace setup](local-development.md#optional-private-workspace) enables signed-in, user-scoped saves. Use fictional material throughout.

1. Open `http://127.0.0.1:3000/estimate` and load the fictional CRM sample. If the OpenAI provider is configured, choose **AI specialist agents** and analyze it. Otherwise, choose **Sample rules**. The sample path is deterministic and makes no AI provider call.
2. In AI mode, explain the data flow before analyzing: the Python analysis service extracts text from an uploaded file; OpenAI receives the request text (extracted text for a file), supplied team capabilities, and the source name and file type. The uploaded file bytes are not sent to OpenAI. Only submit client material you are authorized to share with OpenAI.
3. Inspect the extracted source and the named intake, scope, delivery-risk, capability, and evidence-review steps. Model findings are suggestions. A “Quote found in extracted text” badge means the quoted text occurs in the extracted source; it does not establish that the quote supports the requirement or that the requirement is approved.
4. Use **Show in extracted text** on a work item. Review the highlighted passage, correct a quote or title, or remove a finding the client did not request. Add only supported team capabilities. If no exact passage is found, inspect the full extracted text and correct or remove the quote.
5. For integration work, inspect and confirm or correct the five effort-driver inputs: sync direction, API documentation, data quality, record volume, and field mapping. Confirm the scope only after reviewing the source, evidence, and drivers. No numeric estimate is requested before this review gate.
6. Show the integration formula table: driver-adjusted base hours, the per-package comparable count n, median actual/base ratio, shrinkage weight n/(n+4), factor, adjusted hours, and range. The demo uses fictional synthetic references; it is not a real accuracy evaluation. General-work estimates use fixed uncalibrated priors and receive no history adjustment today.
7. Explain the variation boundary: agent extraction may vary before review; the numeric estimate is deterministic when confirmed inputs and the estimator version are the same. The LLM does not produce the hours.
8. Switch to **Sample rules** explicitly when the provider is unavailable. If an AI request fails, show the error first; do not describe the sample run as a successful live AI result or switch modes silently.
9. Analysis is not saved to the private workspace automatically. Saving a reviewed estimate is a separate action. In the optional private-workspace setup, sign in before saving; the snapshot is encrypted, account-scoped, and retained for the configured period. In the base setup, no private records are stored. Never use confidential client material for this demo.

### Rehearsal checklist

This checklist is a plan, not a record of a completed rehearsal. Mark results only after actually running the flow.

- [ ] Start the selected Compose setup from a clean checkout and open the local estimate page.
- [ ] Complete the fictional brief flow in Sample rules without provider credentials.
- [ ] If AI is configured, complete one fictional AI run and separately demonstrate visible provider failure handling.
- [ ] Repeat the same confirmed estimate inputs and record the estimator version and displayed numeric result.
- [ ] If the optional private workspace is configured, save and reopen a fictional estimate, then repeat with a second account and confirm the workspaces remain isolated.
- [ ] Record the rehearsal date, setup, outcome, and any blocked steps before claiming the walkthrough has been verified.

The hosted product has no representative recorded delivery cohort for this preview. Do not claim improved scoping speed, consistency, or real-world estimate accuracy from the synthetic demo.
