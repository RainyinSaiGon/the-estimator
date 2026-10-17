# The Estimator

## Problem and target
Delivery leads and presales engineers interpret vague software integration briefs before committing to a client. The supplied challenge describes slow, inconsistent scoping and estimates that never learn from actual effort. The user chose software and data integration work; this MVP covers CRM/API synchronization and CSV imports.

The broader product direction is tracked in [Epic #19](https://github.com/RainyinSaiGon/the-estimator/issues/19): accept varied client materials, orchestrate reviewable specialist analysis for scope, unknowns, risks, and team fit, and improve from delivery outcomes. The first Next.js/Python/Go preview implements only a local, ephemeral vertical slice; it is not the authenticated production workspace.

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

## Review and learning improvements

- Question order prioritizes unresolved baseline blockers, then remaining unknowns by the spread of central effort across supported answers. Each scenario holds other answers and the history dataset fixed. It is model sensitivity, not a probability or client quote.
- Source facts have a conservative matching passage. Human confirmations carry the answer, timestamp and review notes. Unverified suggestions remain provisional; the original brief stays unchanged.
- New ordinary requests default to recorded-only history. Sample requests include synthetic examples. Reviewers can change the policy before saving a new baseline. Legacy projects retain demonstration-mode behavior until reviewed.
- New frozen estimates record the engine version, configuration, history policy and every contributing reference ID. Reference details expose matching/known drivers and all task observations. Similarity is not confidence.
- Learning reports compare stored base/adjusted predictions with original-scope actual effort. They separate recorded and synthetic cohorts, exclude added hours, and report sample count, MAE, signed bias and descriptive range coverage. Historical predictions are never recomputed with future outcomes.
- Saved versions and the current draft can be compared by drivers, inclusions, review notes, task effort, range and calculation context. Replacements need a reason. Saved versions remain immutable and can be exported individually.
- Project payloads use schema version 2. Legacy live fields receive explicit defaults; old snapshot fields and values remain unchanged and missing provenance is labelled unknown.

## Later and non-goals
The hosted integration workflow still needs reviewed history CSV import, source-document editing/re-analysis, and representative independent accuracy evaluation. The local preview accepts bounded PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, JSON, and EML intake and offers general-work complexity bands; these bands are uncalibrated. Private estimate snapshot persistence is implemented behind an opt-in generic OIDC/PostgreSQL configuration and stays disabled in the default local preview until a provider and keys are configured. Scanned PDFs need OCR, and unsupported formats are rejected clearly.

The product does not build CRM connectors, autonomously commit to a client, send messages, bill clients, or promise accuracy from synthetic examples. Production use still requires a configured provider, two-user isolation validation, retention/deletion validation, legacy identity mapping, D1 import reconciliation, and a separately approved deployment/cutover.

## Architecture and calibration
The hosted legacy path remains React/Vinext UI → authenticated API → Zod validation → source extraction and pure numeric engine → D1. The new local preview uses Next.js BFF → Python brief service/Go estimator; its optional private-record path uses OIDC at the BFF, short-lived audience-bound BFF-to-Go tokens, and Go-owned encrypted PostgreSQL snapshots. AI reads requirements but never invents numeric hours. Server-side schema validation and exact evidence checks constrain model output. Provider failures are visible. Only server runtime reads the API key.

Five confirmed drivers determine task base hours. Historical matches use a weighted similarity threshold of 0.45. For each task, the median actual/base ratio is shrunk toward 1 with four prior observations; ratios are bounded to [0.35, 3]. Unknown inputs, sparse history and ratio variation widen the heuristic range. Frozen baselines preserve the originally agreed numbers.

Eight fictional reference projects provide demonstration history. Actuals entered using the illustrative fill button remain labelled synthetic. Changed estimates demonstrate calibration, not proven improvement. A future evaluation must keep test projects separate from calibration and compare absolute error and range coverage without outcome leakage.

## Timeline and remaining decisions
The event page reviewed on 17 October 2026 states final submissions are due 19 October, 23:59 Ho Chi Minh City time, and require a hosted working app and full public GitHub source. The overview is public; authenticated workspaces remain private to each user. The source repository is public on GitHub.

Owner decision on 17 October: publish the Site with private authenticated workspaces and leave hosted AI unconfigured for now. Use the sample-parser flow for judging. A local API key does not configure the hosted runtime.

Organizers: team policy and exact venue were not confirmed by the published event FAQ.

## References
- https://cybernetics.anduin.tech/agent-in-the-shell
- https://www.gao.gov/products/gao-20-195g
- https://swehb.nasa.gov/spaces/7150/pages/16449831/SWE-015%2B-%2BCost%2BEstimation
- https://developers.openai.com/api/docs/guides/structured-outputs
