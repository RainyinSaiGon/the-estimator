# Client scoping and delivery evaluation

This folder contains repeatable, local evaluation tooling. No client brief is included. The candidate scoping examples in `scoping-candidates.jsonl` are fictional and remain `draft`; they are not ground truth and the evaluator refuses to score them until a named human reviewer approves each case.

## Scoping set

Use the rubric in `scoping-rubric.md`. A reviewer records source-supported requirements, exact evidence passages, missing questions, and capability-fit labels. A second reviewer independently labels the case. Resolve disagreements with a short adjudication note and preserve both original reviews. Approval records reviewer ID, timestamp, rubric version, and provenance. Keep personal or client material out of this repository unless the owner has consented to its use.

Run:

```powershell
python evaluation/evaluate_scoping.py --dataset evaluation/scoping-candidates.jsonl --predictions path/to/predictions.jsonl
```

Prediction rows are keyed by `caseId` and include `requirements` (`id`, `evidence`), `coveredExpectedRequirementIds`, `predictedMissingQuestionCount`, `matchedMissingQuestionIds`, `capabilityJudgments` (`capability`, `judgment`), `reviewerCorrections`, and `minutesToReviewableScope`. A reviewer must map generated requirements and questions to stable expected IDs before scoring. The runner checks evidence quotes directly against the brief. Metrics report numerators, denominators, and counts overall and by domain. Requirement coverage and missing-question agreement use reviewer-approved expected labels; capability false positives use expected `unsupported` labels.

## Delivery holdout

The Go service assigns a split when it freezes a baseline, before any delivery outcome is submitted. The split uses SHA-256 over `the-estimator-delivery-holdout-v1:<record-id>`; rows with `digest[0] % 5 == 0` go to `holdout`, and all others go to `training`. Imported records with unknown split provenance stay `unassigned`. Do not change the namespace or split rule after inspecting results.

Export private records from the owner-scoped API to JSONL with one `{"id":"...","payload":{...}}` object per line, then run:

```powershell
python evaluation/evaluate_delivery_holdout.py --records path/to/records.jsonl
```

Only approved outcomes with task-level actuals and a matching frozen baseline are included. Recorded outcomes must also be marked calibration eligible. Added-scope hours are excluded. Synthetic outcomes have a separate cohort and never enter recorded calibration. Reports include counts, domain groups, base and adjusted absolute error, signed bias, and observed range coverage. Groups under 30 records are labelled too small for a conclusion. The tool emits measurements only; it does not tune policy or select a model.

## Data handling and limits

Keep private exports outside the repository and delete them when the review is complete. The local tools do not upload data. A report is descriptive of its supplied cohort and cannot establish representativeness by itself. Do not report an accuracy or improvement claim without a sufficiently sized, consented, reviewed, representative recorded cohort.
