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

The report averages errors/bias and counts covered records. It separates cohorts using the outcome's synthetic flag, identifies legacy provenance, excludes incomplete or chronologically invalid records, and excludes added scope. It does not recompute a historical prediction or tune against an outcome being evaluated. Zero records show an empty state; synthetic/small-sample results carry explicit limits.

## Baseline comparison and exports

Comparisons use stored predictions for saved versions. Driver, inclusion and note changes are shown separately from policy, reference-set and engine changes. Without old provenance, attribution is unknown. No numerical causal split is invented when several inputs changed.

Replacement versions require a reason of at least 10 characters, human review, and resolved baseline blockers. Scope/history-policy changes require a new baseline before delivery. A selected saved version can be exported independently of the latest version. Client-authored text is escaped in Markdown, and source lines are quoted.

## Public access

The public root renders the product overview with no user records. Entering a workspace or starting a request directs anonymous visitors to sign-in. The API separately authenticates every request and filters every database read/update by its authenticated owner; making the Site public does not make project payloads public.

The owner requested public Site access and explicitly deferred hosted AI configuration on 17 October 2026. The labelled sample parser remains the hosted demonstration path.
