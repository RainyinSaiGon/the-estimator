import unittest

from evaluate_delivery_holdout import evaluate as evaluate_delivery, expected_split
from evaluate_scoping import evaluate as evaluate_scope


def scope_case(status="approved"):
    return {
        "caseId": "case-1",
        "domain": "integration",
        "approval": {"status": status, "rubricVersion": "1.0"},
        "expected": {
            "requirements": [{"id": "import"}],
            "missingQuestions": [{"id": "api"}],
            "capabilityJudgments": [{"capability": "gateway", "label": "unsupported"}],
        },
    }


def delivery_record(record_id, *, split=None, synthetic=False, calibration=True):
    assigned = split or expected_split(record_id)
    baseline = {"id": "base-1", "sha256": "a" * 64, "evaluationSplit": assigned, "workPackageIds": ["import", "sync"]}
    outcome = {
        "baselineId": "base-1", "baselineSha256": "a" * 64, "evaluationSplit": assigned,
        "reviewStatus": "approved", "synthetic": synthetic, "calibrationEligible": calibration,
        "actualHours": {"import": 8, "sync": 4}, "additionalScopeHours": 50,
    }
    return {"id": record_id, "payload": {"baseline": baseline, "deliveryOutcome": outcome, "estimate": {"hours": 10, "baseHours": 12, "low": 8, "high": 16}, "reviewedScope": {"domain": "integration"}}}


class EvaluationTests(unittest.TestCase):
    def test_scoping_metrics_include_explicit_denominators(self):
        case = scope_case()
        case["brief"] = "Please import contacts from a CSV. The portal API is unknown."
        case["approval"].update({"reviewerId": "reviewer-1", "approvedAt": "2026-10-18T12:00:00Z", "independentReviewers": ["reviewer-2"]})
        prediction = {"caseId": "case-1", "requirements": [{"id": "prediction-1", "evidence": "import contacts from a CSV"}], "coveredExpectedRequirementIds": ["import"], "predictedMissingQuestionCount": 1, "matchedMissingQuestionIds": ["api"], "capabilityJudgments": [{"capability": "gateway", "judgment": "supported"}], "reviewerCorrections": 2, "minutesToReviewableScope": 5}
        result = evaluate_scope([case], [prediction])
        self.assertEqual(result["overall"]["requirementCoverage"], {"numerator": 1, "denominator": 1, "value": 1.0})
        self.assertEqual(result["overall"]["capabilityFalsePositiveRate"]["numerator"], 1)
        self.assertEqual(result["overall"]["sourceEvidenceSupport"]["denominator"], 1)

    def test_unapproved_scoping_examples_are_not_ground_truth(self):
        with self.assertRaisesRegex(ValueError, "no reviewer-approved cases"):
            evaluate_scope([scope_case("draft")], [])

    def test_delivery_holdout_excludes_training_and_added_scope(self):
        holdout_id = next(f"record-{index}" for index in range(100) if expected_split(f"record-{index}") == "holdout")
        training_id = next(f"record-{index}" for index in range(100, 300) if expected_split(f"record-{index}") == "training")
        result = evaluate_delivery([delivery_record(holdout_id), delivery_record(training_id)])
        recorded = result["holdout"]["recorded"]
        self.assertEqual(recorded["count"], 1)
        self.assertEqual(recorded["adjustedAbsoluteError"]["mean"], 2)
        self.assertEqual(result["trainingRecordsExcluded"], 1)

    def test_synthetic_delivery_is_separately_reported_and_never_calibrated(self):
        record_id = next(f"synthetic-{index}" for index in range(100) if expected_split(f"synthetic-{index}") == "holdout")
        result = evaluate_delivery([delivery_record(record_id, synthetic=True, calibration=False)])
        self.assertIn("synthetic", result["holdout"])
        self.assertNotIn("recorded", result["holdout"])

    def test_wrong_split_is_rejected_and_unapproved_delivery_is_excluded(self):
        holdout_id = next(f"record-{index}" for index in range(100) if expected_split(f"record-{index}") == "holdout")
        with self.assertRaisesRegex(ValueError, "split does not match"):
            evaluate_delivery([delivery_record(holdout_id, split="training")])
        record = delivery_record(holdout_id)
        record["payload"]["deliveryOutcome"]["reviewStatus"] = "pending"
        result = evaluate_delivery([record])
        self.assertEqual(result["ineligibleRecordsExcluded"], {"delivery_outcome_not_approved": 1})

    def test_missing_or_legacy_outcomes_are_counted_as_excluded(self):
        record = delivery_record("legacy-id")
        record["payload"]["baseline"]["evaluationSplit"] = "unassigned"
        result = evaluate_delivery([record])
        self.assertEqual(result["ineligibleRecordsExcluded"], {"legacy_split_unknown": 1})


if __name__ == "__main__":
    unittest.main()
