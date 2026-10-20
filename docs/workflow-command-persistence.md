# Sites workflow commands and persistence

`lib/client-workflow.ts` validates the existing action payload, executes the command,
and hydrates its workspace response. Its optional fifth `responseQuery` argument
continues to control the bounded inbox response. Request creation selects the newly
created request in that response, and credential rotation returns the issued token
once as before.

`lib/workflow-commands.ts` declares a role policy for every action and dispatches to
typed handlers. The policy record, handler record, and exhaustive switch are checked
against the validated action union. Company creation uses the account identity;
every company action loads the caller's current company role before dispatch.
Handlers retain workflow decisions, independent delivery review, frozen baseline
checks, and the public-demo cohort policy.

`lib/workflow-command-repository.ts` owns record mapping and D1 persistence.
Configuration and knowledge writes compare the loaded company version with the
submitted expected version, then execute a guarded update and its audit insert in
one D1 batch. The update checks company ID, owner ID, and version. The immediately
following audit insert uses `WHERE changes() = 1`, so a stale update adds no success
event. A zero-change update returns the existing 409 response; a failed statement
rolls back the batch. Company creation now also batches its insert and audit event.
Request updates retain the same guarded update and conditional audit pattern.

Member and credential mutations retain their existing mutation/audit batches.
Request intake retains one batch containing the inbound deduplication row, request,
and receipt audit. AI analysis remains outside that batch and persists its outcome
with a separate guarded request update. Estimate history still reads the full
company history so training and holdout selection is independent of inbox paging.

Request deletion retains its existing version guard, frozen-record restriction,
and private R2 cleanup after the D1 delete. The repository adds the already
authorized company ID to the delete predicate. D1 and R2 are separate storage
systems; this refactor does not introduce a cross-storage transaction or a cleanup
retry mechanism.

No payload, action name, record format, or database schema changes are required.
Rollback is a source revert. Further command-family splitting and durable R2
cleanup retries can be scoped separately without changing the command entry point.

## Verification for issue #82

The root TypeScript check, scoped ESLint for the three affected TypeScript files,
and the Sites production build passed. Static review compared authorization,
version guards, inbound batching, cleanup order, independent review, baseline
snapshots, and complete history reads with the previous implementation.

No tests were added or run. Runtime audit-failure injection, concurrent writer
conflicts, inbound retries, and R2 failure recovery were not exercised by this
change's verification.
