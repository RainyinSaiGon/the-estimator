# Scoping review rubric (version 1.0)

At least two distinct reviewers work independently before discussion. Each reads the source brief first and writes labels before viewing any model output.

For each requirement, record a stable ID, a concise statement, and the shortest exact source passage that supports it. Mark an item unsupported when its source passage does not entail the requirement. Keep implementation suggestions and inferred capabilities out of the source-supported requirement list.

Record material risks separately from requirements. Each risk needs a stable ID, a concise outcome, an exact source passage that raises the concern, a rationale connecting the passage to the risk, and a severity (`low`, `medium`, or `high`). Do not present general industry concerns as case findings without source support. Reviewers may disagree that a passage creates a material risk; preserve both labels and adjudicate it.

Record each missing question only when its answer could materially change scope, risk, feasibility, or estimate. Give it a stable ID, the missing fact, and the reason it matters. Do not label optional discovery questions as blockers.

For every capability judgment, choose `supported`, `unsupported`, or `unknown` and cite the source or profile evidence. A false positive is a model `supported` judgment where the reviewed label is `unsupported`; `unknown` is not a positive.

After independent labels, compare by stable IDs. Store each reviewer's full expected findings, reviewer ID, review timestamp, and rubric version in `approval.reviewRecords`; do not overwrite either independent label with the adjudicated result. Discuss disagreements using the brief and rubric, preserve both labels, and add a concise adjudication note. If unresolved, mark the case `disputed` and exclude it from metrics. Approval requires at least two distinct independent reviewer IDs, a named approver, a UTC timestamp, and a rubric version. The model output must never be used as the expected label.

Capture reviewer corrections as the count of material edits needed before the scope is reviewable. Capture time from first source read to a reviewable scope in minutes. Do not infer or impute either measure when it was not observed.

Each case records domain, source provenance, cohort, inclusion rationale, exclusions, consent/fictional status, limitations, and reviewer decisions. Scoping examples and labels are kept separate from delivery actuals and the delivery holdout.
