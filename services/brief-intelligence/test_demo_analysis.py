import unittest

from main import analysis_error_status, normalize_agent_result


class DemoAnalysisTests(unittest.TestCase):
    def result(self, categories):
        return {
            "estimateMode": "integration",
            "missingInformation": [],
            "requirements": [
                {"id": str(index), "category": category, "title": "Requested work", "evidence": "Original source quote"}
                for index, category in enumerate(categories)
            ],
        }

    def test_timeout_is_distinct_from_configuration_and_provider_failures(self):
        self.assertEqual(analysis_error_status("AI analysis timed out."), 504)
        for detail in ["The configured AI key was rejected.", "Missing inference permissions.", "The AI provider quota is exhausted.", "The AI service is rate-limited."]:
            with self.subTest(detail=detail):
                self.assertEqual(analysis_error_status(detail), 503)
        self.assertEqual(analysis_error_status("The agent result could not be parsed."), 502)

    def test_supported_categories_keep_their_meaning_and_exact_evidence(self):
        result = normalize_agent_result(self.result([" API ", "migration", "sync"]))
        self.assertEqual([item["id"] for item in result["requirements"]], ["authentication", "import", "sync"])
        self.assertTrue(all(item["evidence"] == "Original source quote" for item in result["requirements"]))

    def test_unknown_categories_cannot_silently_become_discovery(self):
        with self.assertRaisesRegex(ValueError, "unsupported integration"):
            normalize_agent_result(self.result(["custom mystery work"]))

    def test_synonyms_cannot_create_duplicate_estimator_task_ids(self):
        with self.assertRaisesRegex(ValueError, "duplicate integration"):
            normalize_agent_result(self.result(["import", "migration"]))


if __name__ == "__main__":
    unittest.main()
