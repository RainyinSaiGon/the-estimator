# The Estimator

## Problem and target
Delivery leads and presales engineers interpret vague software integration briefs before committing to a client. The supplied challenge describes slow, inconsistent scoping and estimates that never learn from actual effort. The user chose software and data integration work; this MVP covers CRM/API synchronization and CSV imports.

## Goals and evidence
- A judge can finish brief → questions → estimate → reviewed baseline → actual hours → next-estimate preview in one browser session.
- Each extracted requirement links to an exact passage of the client brief; every passage is checked in code.
- Numeric estimates are reproducible for fixed scope and history.
- Original-scope actual hours inform subsequent comparable work; additions remain separate.
- Business impact and predictive accuracy remain hypotheses. No real customer interviews or production accuracy measurements have been collected.

## User stories
- As a delivery lead, I want scope, evidence and missing information together so I can correct the interpretation.
- As a presales engineer, I want task estimates and their calculation so I can explain a proposal.
- As a project lead, I want frozen baseline versions and actual original-scope hours so future comparisons stay meaningful.

## P0 requirements
1. Accept a named client brief. Bound input size and reject unsupported or invalid requests.
2. Offer live OpenAI structured extraction and a separately labelled deterministic sample parser. Never silently substitute the sample parser after an API failure.
3. Confirm sync direction, API readiness, data quality, volume and mapping. Save changes and recompute effort.
4. Show task base hours, adjustments from comparable history, and a heuristic planning range. A range is not a calibrated confidence interval or a promised calendar date.
5. Critical unknowns and unsaved review changes prevent saving a baseline. The user must confirm review.
6. Store full immutable baseline snapshots. Changes to the scope require a new baseline before actual effort can be recorded.
7. Require actual hours for every baseline task; bound values and explain added scope. Completion is recorded once.
8. Separate synthetic examples from user-recorded data. Keep additions out of task calibration.
9. Scope persisted D1 records by authenticated user. Reject stale updates and cross-origin mutations.
10. Export estimates to Markdown and workspace records to JSON.

## P1 and non-goals
P1: history CSV import, PDF extraction, richer scope-revision comparison, representative held-out accuracy evaluation.

This version does not build CRM connectors, autonomously commit to a client, send messages, bill clients, estimate arbitrary software domains or promise production accuracy from synthetic examples.

## Architecture and calibration
React/Vinext UI → authenticated API → Zod validation → source extraction and pure numeric engine → D1. AI reads requirements but never invents numeric hours. Server-side schema validation and exact evidence checks constrain model output. Provider failures are visible. Only server runtime reads the API key.

Five confirmed drivers determine task base hours. Historical matches use a weighted similarity threshold of 0.45. For each task, the median actual/base ratio is shrunk toward 1 with four prior observations; ratios are bounded to [0.35, 3]. Unknown inputs, sparse history and ratio variation widen the heuristic range. Frozen baselines preserve the originally agreed numbers.

Eight fictional reference projects provide demonstration history. Actuals entered using the illustrative fill button remain labelled synthetic. Changed estimates demonstrate calibration, not proven improvement. A future evaluation must keep test projects separate from calibration and compare absolute error and range coverage without outcome leakage.

## Timeline and remaining decisions
The event page read on 14 October 2026 states final submissions are due 18 October, 23:59 Ho Chi Minh City time, and require a hosted working app and full public GitHub source. Private Sites previews are not a public submission.

Owner: approve public judge access and choose the public GitHub destination before submitting. The API key was provisioned with a user-selected 24-hour lifetime; renew intentionally before the live event. Hosted runtime secrets require configuration separate from the ignored local env file.

Organizers: team policy and exact venue were not confirmed by the published event FAQ.

## References
- https://cybernetics.anduin.tech/agent-in-the-shell
- https://www.gao.gov/products/gao-20-195g
- https://swehb.nasa.gov/spaces/7150/pages/16449831/SWE-015%2B-%2BCost%2BEstimation
- https://developers.openai.com/api/docs/guides/structured-outputs
