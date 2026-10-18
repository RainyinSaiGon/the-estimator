# Client scoping and delivery evaluation

This folder contains repeatable, local evaluation tooling. No client brief is included. The candidate scoping examples in `scoping-candidates.jsonl` are authored, fictional review drafts; they are not ground truth and the evaluator refuses to score them until a named human reviewer approves each case. Their expected findings are proposals for reviewer inspection, not reviewer-approved labels.

## Scoping set

Use the rubric in `scoping-rubric.md`. Two distinct reviewers independently label each case. They record source-supported requirements, exact evidence passages, missing questions, source-grounded risks, and capability-fit labels. Resolve disagreements with a short adjudication note and preserve both complete original labels in `approval.reviewRecords`. Approval records reviewer IDs, review timestamps, approver, approval timestamp, rubric version, and provenance. Keep personal or client material out of this repository unless the owner has consented to its use.

### Inclusion criteria

- Include a brief only when its original source text is available and the requested work can be reviewed against that source.
- Sample across supported domains, brief lengths, and levels of ambiguity; record domain and inclusion rationale for every case.
- Include both explicit requirements and materially important unknowns when they are present. Do not select cases based on whether the estimator handled them well.
- Use fictional examples or client material with documented consent. Remove names, contact details, credentials, and other unnecessary identifying details before adding a case.
- Exclude duplicate or near-duplicate briefs, incomplete source extracts, cases with unresolved consent, and any material derived from the delivery holdout.

An approved case requires two distinct independent reviewer IDs, both original review records, an attributable approval, a UTC timestamp, and a rubric version. The schema and evaluator enforce distinct reviewers and retained review records; they do not replace human review or adjudication.

The scoping report includes evidence support, requirement coverage, missing-question precision/recall, risk precision/recall, unsupported-capability false-positive rate, observed reviewer corrections, and observed review time, with denominators and domain breakdowns. Risk matching uses stable reviewer-approved risk IDs just like missing-question matching.

Run:

```powershell
python evaluation/evaluate_scoping.py --dataset evaluation/scoping-candidates.jsonl --predictions path/to/predictions.jsonl
```

Prediction rows are keyed by `caseId` and include `requirements` (`id`, `evidence`), `coveredExpectedRequirementIds`, `predictedMissingQuestionCount`, `matchedMissingQuestionIds`, `predictedRiskCount`, `matchedRiskIds`, `capabilityJudgments` (`capability`, `judgment`), `reviewerCorrections`, and `minutesToReviewableScope`. A reviewer must map generated requirements, questions, and risks to stable expected IDs before scoring. The runner checks requirement evidence quotes directly against the brief. Metrics report numerators, denominators, and counts overall and by domain. Requirement coverage, missing-question agreement, and risk agreement use reviewer-approved expected labels; capability false positives use expected `unsupported` labels.

## Delivery holdout

The Go service assigns a split when it freezes a baseline, before any delivery outcome is submitted. The split uses SHA-256 over `the-estimator-delivery-holdout-v1:<record-id>`; rows with `digest[0] % 5 == 0` go to `holdout`, and all others go to `training`. Imported records with unknown split provenance stay `unassigned`. Do not change the namespace or split rule after inspecting results.

Export private records from the owner-scoped API to JSONL with one `{"id":"...","payload":{...}}` object per line, then run:

```powershell
python evaluation/evaluate_delivery_holdout.py --records path/to/records.jsonl
```

Only approved outcomes with task-level actuals and a matching frozen baseline are included. Recorded outcomes must also be marked calibration eligible. Added-scope hours are excluded. Synthetic outcomes have a separate cohort and never enter recorded calibration. Reports include counts, domain groups, base and adjusted absolute error, signed bias, and observed range coverage. Groups under 30 records are labelled too small for a conclusion. The tool emits measurements only; it does not tune policy or select a model.

## Data handling and limits

Keep private exports outside the repository and delete them when the review is complete. The local tools do not upload data. A report is descriptive of its supplied cohort and cannot establish representativeness by itself. Do not report an accuracy or improvement claim without a sufficiently sized, consented, reviewed, representative recorded cohort.
