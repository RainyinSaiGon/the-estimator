# Ten-minute demonstration

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
- The owner chose to leave hosted AI unconfigured. Use **Try a sample** and keep the sample-parser label visible.
- Open the public overview, sign in to a separate private workspace, and confirm judge access.
- Submit https://github.com/RainyinSaiGon/the-estimator as the public source repository.
- Check an unfamiliar brief, source evidence, failed-provider behavior and the complete delivery cycle once more after any material changes.
