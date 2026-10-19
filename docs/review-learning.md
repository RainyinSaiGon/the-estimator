# Review and learning model

## Sensitivity and confirmation

`questionImpact` evaluates supported non-unknown driver values through the deterministic estimator with the same other drivers and history dataset. Baseline blockers appear first, then other unknowns by their central-effort spread. Matching references can change when a driver changes; the source dataset itself stays fixed.

`sourceSupport` finds conservative contiguous source passages for the current value. A related requirement passage supplies context when the answer is absent, and is labelled as context. Selecting an answer or explicitly confirming an existing one records a human confirmation on save. The original brief is immutable.

## History and provenance

- `recorded`: exclude synthetic references. With no eligible observations, each factor is 1.
- `demo`: include labelled synthetic and recorded examples.

The active request is excluded from its own estimate. The after-delivery preview intentionally removes that identity to illustrate a new comparable request. Only original-scope actuals enter history; additions remain separate.

New estimates record engine `integration-effort/2.0`, driver weights, similarity threshold, prior strength, ratio bounds and the full set of contributing reference IDs. Each task stores its own reference IDs. Delivered records are immutable, so their referenced values cannot be edited through the current API.

Legacy snapshots retain their stored numbers and fields. Their missing provenance is unknown. A live legacy project defaults to demonstration mode to preserve the previous history-selection policy. New ordinary work defaults to recorded-only history, independently of which parser reads the brief.

## Learning report

Each eligible completed project contributes one paired observation from its latest agreed frozen baseline:

- base error: `abs(baseline.baseHours - originalScopeActual)`
- adjusted error: `abs(baseline.hours - originalScopeActual)`
- signed bias: `baseline.hours - originalScopeActual`
- observed coverage: whether the original actual falls between the stored low/high bounds

The account recording task actuals must designate a different verified first-party account as reviewer. Only that assigned account can inspect the review bundle and approve or reject it. The service records both authenticated account IDs; self-approval remains ineligible even if a client submits a forged `calibrationEligible` flag. The holdout evaluator repeats this actor check before including a recorded outcome.

The report averages errors/bias and counts covered records. It separates cohorts using the outcome's synthetic flag, identifies legacy provenance, excludes incomplete or chronologically invalid records, and excludes added scope. It does not recompute a historical prediction or tune against an outcome being evaluated. Zero records show an empty state; synthetic/small-sample results carry explicit limits.

## Learned-policy review gate

The current estimator has no online learning or dynamic policy loader. Delivery outcomes do not alter later estimates. Integration estimates report `policyVersion: fixed-calibration/v1`; general estimates report `uncalibrated-priors/v1`. An unreviewed proposal therefore cannot reach the estimate path.

Any future learned adjustment or changed agent policy must be submitted as a versioned proposal with affected domain/cohort, eligible sample count, evidence and data provenance, holdout results, current-policy comparison, limitations, and rollback version. A named reviewer must explicitly approve, reject, or defer it in the proposal review record before a policy change can be activated. Approval must be part of the code review for the corresponding change; the deployed code carries the new `policyVersion`. Do not load proposal values directly from a client request or an unreviewed record.

This is deliberately a code-review governance gate. The JSON Schema is a proposal artifact format and the contract check validates draft and decision states; the application has no runtime proposal submission, approval, or dynamic policy-loading workflow. A product-level policy approval interface would be a separate follow-up if policy changes need to be proposed and approved inside the application.

Rollback restores a previously reviewed policy version for future estimates. Each saved estimate retains its original engine and policy versions, reviewed scope, and frozen values. A policy rollback never recalculates or changes historical baselines.

## Baseline comparison and exports

Comparisons use stored predictions for saved versions. Driver, inclusion and note changes are shown separately from policy, reference-set and engine changes. Without old provenance, attribution is unknown. No numerical causal split is invented when several inputs changed.

Replacement versions require a reason of at least 10 characters, human review, and resolved baseline blockers. Scope/history-policy changes require a new baseline before delivery. A selected saved version can be exported independently of the latest version. Client-authored text is escaped in Markdown, and source lines are quoted.

## Public access in the separate Next.js app

This section describes `apps/web`, which is separate from the hosted Sites application at the judge URL. Its public root renders the product overview with no user records. Entering a private estimate workspace or starting a request directs anonymous visitors to sign-in. The API separately authenticates every request and filters every database read/update by its authenticated owner.

The hosted Sites public demo has a different access model: anonymous visitors share a synthetic company workspace, and request analysis uses the configured OpenAI service. See [Sites releases and public demo limits](sites-release.md) and the [judge walkthrough](public-demo-runbook.md). Never use real client data or treat synthetic outcomes as delivery evidence.
