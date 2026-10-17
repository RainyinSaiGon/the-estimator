# Delivery history CSV import

The Project history page accepts completed integration records after a person reviews the parsed preview. Each row becomes one private, recorded-history reference in the signed-in workspace. The CSV is parsed in the browser; imported data is not sent to an AI provider.

## Template columns

Download `estimator-history-template.csv` from Project history. It contains the supported headers. You can map different source headers to these fields in the preview.

| Field | Template header | Rules |
| --- | --- | --- |
| Source record ID | `source_id` | Optional, up to 150 characters. Repeated IDs in the same source file are treated as duplicates. |
| Project name | `project_name` | Required, 3–120 characters. |
| Frozen baseline date | `baseline_at` | Required ISO date (`YYYY-MM-DD`) or ISO timestamp with a timezone. Must be on or before delivery date. |
| Delivery date | `completed_at` | Required ISO date or timestamp with a timezone. |
| Scope drivers | `direction`, `api`, `quality`, `volume`, `mapping` | Required; use the values listed below. Use `unknown` when the historical record does not establish a driver. |
| Task baseline and actuals | `baseline_<task>_hours`, `actual_<task>_hours` | Include the original frozen estimate and matching original-scope actual for each task. Leave both blank for a task not in the baseline. A populated value must be greater than 0 and at most 10,000 hours. At least one pair is required. |
| Original estimate range | `range_low_hours`, `range_high_hours` | Optional. Supply both or leave both blank. When supplied, the range must contain the sum of the task baseline hours. |
| Added-scope actual | `additional_hours` | Required column; a blank value is treated as 0. Values range from 0 to 10,000 hours. Added-scope actuals stay separate from task actuals and are excluded from calibration. |
| Added-scope explanation | `additional_scope_notes` | Required when added-scope hours are greater than 0: at least 10 characters and no more than 3,000. |

The supported task names are `discovery`, `authentication`, `mapping`, `import`, `sync`, `deduplication`, `testing`, and `handover`.

Use these exact driver values:

| Driver | Values |
| --- | --- |
| `direction` | `unknown`, `one-way`, `two-way` |
| `api` | `unknown`, `documented`, `custom` |
| `quality` | `unknown`, `clean`, `mixed` |
| `volume` | `unknown`, `small`, `medium`, `large` |
| `mapping` | `unknown`, `standard`, `custom` |

Use a period for decimal hours. Thousands separators are optional (`1200` or `"1,200"`); quote CSV fields containing commas. Standard quoted CSV fields support commas, line breaks, and doubled quote characters.

## Review and import

1. Select a CSV file no larger than 250 KB with no more than 25 non-empty delivery rows.
2. Map every required field. Each source column can map to only one supported field.
3. Inspect the row preview. Invalid rows show their validation reason. Exact repeated rows and repeated source IDs from the same filename are marked as duplicates and cannot be selected.
4. Select the valid rows to save and choose **Import**. The server validates selected rows again before storing them; an invalid selected row rejects the batch instead of partially saving it. Duplicate rows are skipped safely on re-import.

Imports keep the source filename, CSV row number, import time, optional source ID, and a content fingerprint. Imported records are marked recorded and private to the signed-in workspace. Their frozen task baselines are stored as supplied; the estimator does not reconstruct a missing historical estimate. Only original-scope actuals can inform later task comparisons. The import does not establish predictive accuracy.

The downloaded template is intentionally blank. Enter values from reviewed historical records; do not use illustrative or placeholder data as real delivery history.
