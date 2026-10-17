# Verification — 16 October 2026

- 16 deterministic domain tests passed with Node's test runner.
- TypeScript `tsc --noEmit` passed.
- Vinext production build passed using the project's direct framework entrypoint.
- The local D1 migration applied successfully.
- Browser walkthrough passed: live `gpt-5.4-mini` extraction, source evidence, reviewed answers, baseline saving, illustrative actual effort, separate added scope, and next-estimate preview.
- Reload retained the completed record. JSON export was read back and checked: one fictional project; baseline 98.3 h; original-scope actual effort 116 h; additional scope 6 h; actuals labelled synthetic.
- Local API checks passed for anonymous access, cross-origin mutations, invalid input, missing projects, stale writes, completed-record protection and unchanged baselines.
- The local credential was absent from the generated deployment output.

An initial AI result was rejected by source validation. Evidence matching was refined to accept only whitespace / typographic-quote differences while returning the exact original passage; a subsequent live request passed. Guard checks also keep unconfirmed API readiness from being treated as custom implementation.

The Windows Sites package-manager shim failed to locate its npm entrypoint. The same project installer and framework scripts ran successfully through their direct Node entrypoints. No dependency or global package-manager changes were needed.

## Limits
These checks establish the prototype's workflow and calculation behavior. The sample project library and illustrative delivery values are synthetic. They do not establish production prediction accuracy. Hosted runtime credentials and public judge access are separate from local verification.

## UI refresh — 17 October 2026

- Inspected the live ElevenLabs landing page and adapted its visual direction to The Estimator.
- Browser review covered the overview, all three preview tabs, arrow-key tab navigation, the prefilled sample dialog, the stored request, and effort breakdown navigation.
- Reviewed the mobile overview at a 390 px viewport. The document had no horizontal overflow; the request dialog remained centered within the viewport.
- Fixed dialog centering and increased the mobile product scene height to keep the scope illustration in view.
- TypeScript and the production build passed after the UI changes.
- Saved the desktop overview screenshot to `outputs/estimator-elevenlabs-overview.jpg` (ignored local artifact).

The UI review used the existing fictional local record and did not create a new delivery or make an AI API call. Domain and API regression tests were not rerun for this visual refresh.


## Clarification, baseline, and learning workflow — 17 October 2026

- TypeScript `node node_modules/typescript/bin/tsc --noEmit` passed.
- The Vinext production build passed after the feature changes; the final packaging uses the same source inputs.
- The deployment credential-boundary check passed. No AI request was made for this workflow review.
- Manual browser review used fictional local records and the sample parser. Three unresolved drivers were ranked with sync direction and API readiness first; source support remained separate from related context and human confirmations.
- Recorded-only history produced an 85.8 h base estimate with no synthetic calibration. Baseline v1 preserved that prediction. A two-way/demo-history revision produced 120.6 h, required a replacement reason, and was saved as v2; the stored v1 stayed unchanged.
- Delivery was blocked while the reviewed scope differed from the latest baseline. A synthetic delivery recorded 140.6 original-scope hours and 6 additional hours against v2.
- The learning report defaulted to no recorded outcomes. Its separate synthetic cohort contained two frozen predictions: base MAE 32.5 h, adjusted MAE 18.85 h, signed bias -18.85 h, and descriptive coverage 2/2. Added scope was excluded. These fictional outcomes do not establish real prediction accuracy.
- The older completed record retained its legacy snapshot and displayed unknown provenance. Reload retained the new baselines, reason, confirmations, and delivery.
- Baseline v1 Markdown was downloaded and read back with its original 85.8 h, 70–128 h range, recorded-only policy, and engine version. Client clarifications copied and downloaded with source context and explicit model-sensitivity wording.
- At a 390 px viewport, the new learning report and request form remained usable with contained horizontal table scrolling and no document overflow. The viewport override was reset.
- An anonymous local overview rendered without private project data; the workspace API rejected unsigned requests, including forged identity headers.

Automated domain/API regression tests and lint were not rerun for this implementation. A second authenticated user was not available for a browser isolation walkthrough. Public Site access is explicitly authorized, with authenticated owner-scoped records; hosted AI remains unconfigured at the owner's request. The labelled sample-parser flow remains available.
