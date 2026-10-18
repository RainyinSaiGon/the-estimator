#!/usr/bin/env python3
"""Describe frozen estimate error on a preassigned delivery holdout."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

SPLIT_NAMESPACE = "the-estimator-delivery-holdout-v1:"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: expected an object")
        rows.append(value)
    return rows


def expected_split(record_id: str) -> str:
    digest = hashlib.sha256((SPLIT_NAMESPACE + record_id).encode()).digest()
    return "holdout" if digest[0] % 5 == 0 else "training"


def group_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(rows)
    if not n:
        return {"count": 0, "sampleLimit": "no eligible deliveries"}
    base_errors = [abs(row["baseHours"] - row["actualHours"]) for row in rows]
    adjusted_errors = [abs(row["estimateHours"] - row["actualHours"]) for row in rows]
    bias = [row["estimateHours"] - row["actualHours"] for row in rows]
    coverage = [row["low"] <= row["actualHours"] <= row["high"] for row in rows]
    return {
        "count": n,
        "workDomains": dict(sorted((domain, count) for domain, count in __import__("collections").Counter(row["domain"] for row in rows).items())),
        "baseAbsoluteError": {"sum": sum(base_errors), "denominator": n, "mean": sum(base_errors) / n},
        "adjustedAbsoluteError": {"sum": sum(adjusted_errors), "denominator": n, "mean": sum(adjusted_errors) / n},
        "signedBias": {"sum": sum(bias), "denominator": n, "mean": sum(bias) / n},
        "observedRangeCoverage": {"covered": sum(coverage), "denominator": n, "rate": sum(coverage) / n},
        "sampleLimit": "too small for a conclusion" if n < 30 else "descriptive only; representativeness must be reviewed",
    }


def normalize_record(row: dict[str, Any]) -> dict[str, Any]:
    record_id = row.get("id")
    payload = row.get("payload")
    if not isinstance(record_id, str) or not record_id or not isinstance(payload, dict):
        raise ValueError("each record needs an id and payload")
    baseline = payload.get("baseline")
    outcome = payload.get("deliveryOutcome")
    if not isinstance(baseline, dict):
        return {"skipReason": "missing_frozen_baseline"}
    if baseline.get("evaluationSplit") == "unassigned":
        return {"skipReason": "legacy_split_unknown"}
    if not isinstance(outcome, dict):
        return {"skipReason": "delivery_outcome_missing"}
    if outcome.get("reviewStatus") != "approved":
        return {"skipReason": "delivery_outcome_not_approved"}
    split = baseline.get("evaluationSplit")
    if split not in ("training", "holdout") or outcome.get("evaluationSplit") != split:
        raise ValueError(f"record {record_id} has no valid preassigned evaluation split")
    if split != expected_split(record_id):
        raise ValueError(f"record {record_id} split does not match the documented deterministic assignment")
    if outcome.get("baselineId") != baseline.get("id") or outcome.get("baselineSha256") != baseline.get("sha256"):
        raise ValueError(f"record {record_id} delivery does not match its frozen baseline")
    estimate = payload.get("estimate", {})
    actuals = outcome.get("actualHours", {})
    expected_ids = set(baseline.get("workPackageIds", []))
    if not isinstance(actuals, dict) or set(actuals) != expected_ids or not expected_ids:
        raise ValueError(f"record {record_id} actual work packages do not exactly match the frozen estimate")
    try:
        actual_total = sum(float(actuals[key]) for key in expected_ids)
        estimate_hours = float(estimate["hours"])
        base_hours = float(estimate["baseHours"])
        low, high = float(estimate["low"]), float(estimate["high"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"record {record_id} has invalid frozen estimate or actual hours") from error
    if outcome.get("evaluationSplit") != "holdout":
        return {"split": split}
    synthetic = outcome.get("synthetic") is True
    if not synthetic:
        decisions = outcome.get("reviewDecisions")
        last_decision = decisions[-1] if isinstance(decisions, list) and decisions else {}
        submitted_by = outcome.get("submittedBy")
        reviewer_id = outcome.get("reviewerId")
        if not isinstance(submitted_by, str) or not submitted_by or not isinstance(reviewer_id, str) or not reviewer_id or submitted_by == reviewer_id or last_decision.get("actorId") != reviewer_id or last_decision.get("decision") != "approved":
            return {"split": "holdout", "skipReason": "delivery_outcome_not_independently_reviewed"}
        if outcome.get("calibrationEligible") is not True:
            return {"split": "holdout", "skipReason": "recorded_outcome_not_calibration_eligible"}
    scope = payload.get("reviewedScope") or {}
    domain = scope.get("domain", "unknown") if isinstance(scope, dict) else "unknown"
    return {"split": split, "synthetic": synthetic, "domain": domain, "actualHours": actual_total, "estimateHours": estimate_hours, "baseHours": base_hours, "low": low, "high": high}


def evaluate(records: list[dict[str, Any]]) -> dict[str, Any]:
    by_cohort: dict[str, list[dict[str, Any]]] = defaultdict(list)
    training_count = 0
    skipped_reasons: dict[str, int] = defaultdict(int)
    seen = set()
    for row in records:
        record_id = row.get("id")
        if record_id in seen:
            raise ValueError("record IDs must be unique")
        seen.add(record_id)
        normalized = normalize_record(row)
        if normalized.get("skipReason"):
            skipped_reasons[normalized["skipReason"]] += 1
            continue
        if normalized["split"] == "training":
            training_count += 1
            continue
        key = "synthetic" if normalized["synthetic"] else "recorded"
        by_cohort[key].append(normalized)
    return {
        "status": "measured" if by_cohort else "no_eligible_holdout",
        "splitRule": "sha256(the-estimator-delivery-holdout-v1:<record-id>)[0] % 5 == 0",
        "trainingRecordsExcluded": training_count,
        "ineligibleRecordsExcluded": dict(sorted(skipped_reasons.items())),
        "holdout": {cohort: group_metrics(rows) for cohort, rows in sorted(by_cohort.items())},
        "limitations": ["Added-scope hours are excluded from original-scope actual totals.", "Synthetic outcomes remain separate and are never eligible for recorded calibration.", "The report does not tune policy or select a method.", "Small or unrepresentative cohorts do not support general performance claims."],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", required=True, type=Path)
    args = parser.parse_args()
    try:
        output = evaluate(read_jsonl(args.records))
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
