# Workspace planning and commitment controls

Both runtimes use the same visible journey: receive a brief and inspect AI evidence, review scope, calculate effort, then commit and track delivery. Sites uses `/company-workspace`; the Next.js/Go preview uses `/workspace`. Requests open in a focused detail view, with a button back to the request list. Company configuration revisions remain in settings and audit details.

## Review before commitment

AI work packages are provisional and contain no effort hours. Review the task template, units, owner, completion criteria, prerequisites, and quotation or inference supporting each task. The estimator calculates low, central, and high effort after scope approval. A company-configurable task sizing guideline (16 central hours by default) suggests splitting large tasks; it is advisory.

The Next.js/Go preview now requires an answer or a not-applicable reason for each original AI question and conflict. Removing an original question from the editable scope cannot bypass this requirement. The check runs again at effort calculation and baseline freeze, so older approvals cannot bypass the gate. Sites retains its existing shared review policy, including individual finding decisions and reviewer-added questions.

## Delivery dates and availability

The commitment screen has a delivery schedule form with:

- A start date, working weekdays, and company holidays.
- Member assignments and available hours per working day.
- Date-specific capacity overrides: `2026-10-26=0` means leave; `2026-10-27=3` means three hours available after other commitments.
- Explicit task dependencies and optional earliest-start dates. External prerequisites require a human-entered ready date.

The server reads central effort from the frozen estimate. Client-supplied effort cannot replace it. Tasks assigned to the same person share daily capacity, weekends and holidays are skipped according to the selected calendar, and dependencies use a finish-to-start relationship on a following day. The planner is deterministic and processes ready tasks in baseline order; it does not optimize the resource allocation. Invalid dates, duplicate or foreign task/member IDs, dependency cycles, and plans exceeding a two-year horizon are rejected.

The saved schedule includes its full input, calculated task dates, planning actor/time, and baseline ID/digest. Review it, then choose **Apply scheduled dates to task tracking** to copy assignments and dates while retaining progress and milestones. It stays separate from the frozen effort baseline. This is an explicit planning scenario: external calendars are not synchronized, and other project commitments must be reflected in the declared capacity. Replanning does not change agreed effort or original-scope evaluation inputs.

## Tracking and scope changes

Task tracking stores status, assignee, dates, a required description when blocked, and dated milestones. Tracking and scheduling stop accepting updates after delivery actuals are submitted; rejected actuals may be corrected through the existing review workflow.

Scope changes are proposed against a baseline ID and digest. An estimator or administrator approves or rejects each proposal with a reason. The decision records a stable actor ID and timestamp, is audited, and cannot be overwritten by another decision. Approved added work needs its own plan; it does not silently enter the original frozen scope. Added-scope actuals stay excluded from original-scope training and holdout results.

| Operation | Sites action | Next.js/Go action |
| --- | --- | --- |
| Save task progress and milestones | `saveTracking` | `tracking.update` |
| Calculate and save schedule | `saveSchedule` | `schedule.plan` |
| Apply reviewed schedule to tracking | `applySchedule` | `schedule.apply` |
| Propose scope change | `saveTracking` with `scopeChange` | `scope_change.propose` |
| Approve or reject scope change | `reviewScopeChange` | `scope_change.review` |

Sites commands use request `expectedVersion`; Go commands use the enclosing company `expectedVersion`. Go commitment commands also require the current `baselineId`. Both services validate company membership, current baseline binding, bounds, dates, and prior decisions. Optional JSON fields preserve older records without a database migration.

## Verification

`npm test` covers capacity sharing, partial availability, holidays/weekends, prerequisites, cycles, invalid dates, and bounded planning. Go tests cover equivalent scheduling, review gates, permissions, decision immutability, and baseline preservation. `node scripts/check-sites-workflow.mjs` starts the compiled Worker with disposable local D1/R2, exercises the HTTP commands and role checks, and verifies that scheduling and scope-change decisions preserve the baseline digest. Its controlled analysis fixture is not real AI evidence.

On 20 October 2026, a separate real browser run on the existing live Site analyzed the fictional brief “FICTIONAL #87 — Real AI workflow verification” with `gpt-5.4-mini` in 13.4 seconds. It returned five provisional work packages with supporting quotations and five clarification questions. This verifies a functioning provider connection and workflow behavior, not estimate accuracy. The browser used an existing owner session. Anonymous access and permissions are exercised separately by the local Worker checks. The new branch's Python AI path still requires a usable local key for live provider verification; no key was created after the local-save prompt was declined.

Representative recorded scoping cases and independently approved delivery outcomes for issues #38 and #39 remain separate evidence-collection requirements. Gmail remains deferred on Sites under #55.
