# Sites scope review readiness

Tracking: [issue #80](https://github.com/RainyinSaiGon/the-estimator/issues/80).

`lib/review-policy.ts` owns the pure review policy. It imports only types and has no database, identity, network, or runtime configuration dependency.

- `evaluateReviewDecisions` returns expected finding decisions, question rows, complete/unresolved counts, and structured blocker codes. It rejects changed original question lists, unsupported analysis question keys, invalid reviewer question identifiers, unsupported finding keys, and corrections or rejections without explanations. Invalid entries never make an otherwise incomplete scope ready.
- `evaluateScopeReadiness` adds the requirements for an analysis, deliverables, work domain, at least one work package, configured required fields, and acknowledgement of incomplete or truncated attachments. Pass the company configuration when computing full readiness; omitting it cannot determine configuration-specific requirements.
- `lib/review-policy-messages.ts` maps the policy codes to editor/server copy. Changing wording does not change readiness decisions.
- `scopeReviewBlockers` remains a compatibility helper for review-decision validation only. Confirmation, estimation, freezing, the editor, and the active review queue use full readiness instead.

`getScopeReviewState` is an editor adapter over the same result used by `scopeReadinessBlockers`. `workflowInsights` derives finding/question counts and next actions from that result. It continues to exclude committed requests from the active review queue. A scope with no analysis, no tasks, missing required fields, or unacknowledged source limitations cannot be recommended for effort calculation or commitment merely because its findings were reviewed.

This change does not replace server validation of action payloads, configured product/field identifiers, approval/version guards, frozen baseline immutability, or independent delivery review. Those checks stay in their existing command paths. It does not change evaluation eligibility or training/holdout separation.

Existing insights fixtures were completed to describe an actually ready scope; no test cases were added. Typechecking and scoped linting are compilation/static checks, not proof of runtime behavior. No tests or live deployment are included in this change.
