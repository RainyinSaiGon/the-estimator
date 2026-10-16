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
