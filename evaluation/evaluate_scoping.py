#!/usr/bin/env python3
"""Score scoping predictions against explicitly approved human labels."""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any


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


def ratio(numerator: int | float, denominator: int | float) -> dict[str, Any]:
    return {"numerator": numerator, "denominator": denominator, "value": numerator / denominator if denominator else None}


def normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).casefold()).strip()


def evaluate_group(cases: list[dict[str, Any]], predictions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    evidence_supported = predicted_requirement_count = covered = expected_requirement_count = 0
    missing_tp = missing_fp = missing_fn = capability_fp = unsupported_count = 0
    corrections: list[float] = []
    minutes: list[float] = []
    for case in cases:
        prediction = predictions[case["caseId"]]
        expected = case["expected"]
        predicted_requirements = prediction.get("requirements", [])
        source_text = normalized_text(case["brief"])
        evidence_supported += sum(bool(item.get("evidence")) and normalized_text(item["evidence"]) in source_text for item in predicted_requirements)
        predicted_requirement_count += len(predicted_requirements)
        expected_ids = {item["id"] for item in expected["requirements"]}
        covered_ids = set(prediction.get("coveredExpectedRequirementIds", []))
        if not covered_ids <= expected_ids:
            raise ValueError(f"prediction {case['caseId']} maps a requirement to an unknown expected requirement ID")
        covered += len(covered_ids)
        expected_requirement_count += len(expected_ids)
        gold_questions = {item["id"] for item in expected["missingQuestions"]}
        matched_questions = set(prediction.get("matchedMissingQuestionIds", []))
        predicted_question_count = prediction.get("predictedMissingQuestionCount", 0)
        if not matched_questions <= gold_questions or predicted_question_count < len(matched_questions):
            raise ValueError(f"prediction {case['caseId']} has invalid missing-question matches or counts")
        missing_tp += len(matched_questions)
        missing_fp += predicted_question_count - len(matched_questions)
        missing_fn += len(gold_questions - matched_questions)
        predicted_capabilities = {item["capability"]: item["judgment"] for item in prediction.get("capabilityJudgments", [])}
        for expected_capability in expected["capabilityJudgments"]:
            if expected_capability["label"] == "unsupported":
                unsupported_count += 1
                capability_fp += predicted_capabilities.get(expected_capability["capability"]) == "supported"
        if isinstance(prediction.get("reviewerCorrections"), (int, float)):
            corrections.append(float(prediction["reviewerCorrections"]))
        if isinstance(prediction.get("minutesToReviewableScope"), (int, float)):
            minutes.append(float(prediction["minutesToReviewableScope"]))
    return {
        "caseCount": len(cases),
        "sourceEvidenceSupport": ratio(evidence_supported, predicted_requirement_count),
        "requirementCoverage": ratio(covered, expected_requirement_count),
        "missingQuestionAgreement": {
            "precision": ratio(missing_tp, missing_tp + missing_fp),
            "recall": ratio(missing_tp, missing_tp + missing_fn),
            "truePositive": missing_tp,
            "falsePositive": missing_fp,
            "falseNegative": missing_fn,
        },
        "capabilityFalsePositiveRate": ratio(capability_fp, unsupported_count),
        "reviewerCorrections": {"sum": sum(corrections), "count": len(corrections), "mean": sum(corrections) / len(corrections) if corrections else None},
        "minutesToReviewableScope": {"sum": sum(minutes), "count": len(minutes), "mean": sum(minutes) / len(minutes) if minutes else None},
    }


def evaluate(dataset: list[dict[str, Any]], predictions: list[dict[str, Any]]) -> dict[str, Any]:
    approved = [case for case in dataset if case.get("approval", {}).get("status") == "approved"]
    if not approved:
        raise ValueError("no reviewer-approved cases; draft labels are never treated as ground truth")
    for case in approved:
        approval = case.get("approval", {})
        reviewers = approval.get("independentReviewers")
        if (
            not isinstance(approval.get("reviewerId"), str)
            or not approval["reviewerId"].strip()
            or not approval.get("approvedAt")
            or not approval.get("rubricVersion")
            or not isinstance(reviewers, list)
            or len(reviewers) < 2
            or any(not isinstance(reviewer, str) or not reviewer.strip() for reviewer in reviewers)
            or len({reviewer.strip() for reviewer in reviewers}) != len(reviewers)
        ):
            raise ValueError(f"approved case {case.get('caseId')} needs an attributable approval and two distinct independent reviewers")
    case_ids = [case.get("caseId") for case in approved]
    if any(not isinstance(case_id, str) or not case_id for case_id in case_ids) or len(set(case_ids)) != len(case_ids):
        raise ValueError("approved case IDs must be non-empty and unique")
    by_id: dict[str, dict[str, Any]] = {}
    for prediction in predictions:
        case_id = prediction.get("caseId")
        if not isinstance(case_id, str) or case_id in by_id:
            raise ValueError("prediction case IDs must be non-empty and unique")
        by_id[case_id] = prediction
    if set(by_id) != set(case_ids):
        raise ValueError("predictions must contain exactly one row for every approved case and no others")
    result: dict[str, Any] = {"status": "measured", "labelSource": "reviewer-approved", "rubricVersions": sorted({case["approval"]["rubricVersion"] for case in approved}), "overall": evaluate_group(approved, by_id), "byDomain": {}}
    domains: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for case in approved:
        domains[case.get("domain", "unknown")].append(case)
    result["byDomain"] = {domain: evaluate_group(cases, by_id) for domain, cases in sorted(domains.items())}
    result["limitations"] = ["Descriptive results apply only to the supplied approved cases.", "Small or unrepresentative domain cohorts cannot support general accuracy claims."]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--predictions", required=True, type=Path)
    args = parser.parse_args()
    try:
        output = evaluate(read_jsonl(args.dataset), read_jsonl(args.predictions))
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
