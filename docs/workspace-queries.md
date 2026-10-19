# Sites workspace queries

Issue #81 separates reads from the existing command dispatcher in `lib/client-workflow.ts`.

`GET /api/company-workspace?company=<id>&inbox=1` opts into a bounded inbox. Its `inbox.items` contain request identity, status, timestamps, request type and analysis presence, with no analysis, attachments, review or baseline payloads. `limit` defaults to 25 and is capped at 50; `offset` pages the ordered results. `q` performs literal, case-insensitive title, brief, status and request-type search, limited to 200 characters. Ordering is `updated_at DESC, id DESC` for deterministic ties.

Add `request=<id>` to hydrate one request into `company.requests` and return its ID in `selectedId`. The company authorization check precedes inbox and detail reads, and attachment object keys remain private. POSTs accept the same query parameters so their responses preserve the inbox page and selected detail. Creating a request selects its new ID in the response.

Calls without `inbox=1` keep the legacy `company.requests` collection contract. This compatibility response contains the complete company collection; consumers needing bounded payloads must opt into the inbox contract.

Evaluation, activity and exports always traverse every company request in batches of 25 using an ID cursor, independently of inbox offset, search or selected detail. Evaluation accumulates counts, errors, coverage and domains without retaining the full cohort. Activity retains aggregate counts and the five most recently updated next actions plus their total count. Recorded and synthetic outcomes, independent-review requirements and training/holdout separation retain their existing policy.

`view=evaluation` returns the full-cohort metrics. `view=export` streams complete JSONL records, one per request, with no inbox cap. Export encoding retains the existing delivery-record schema and latest-baseline/outcome behavior. The former 200-request admission/response limits are removed after these independent traversal paths are present. Estimation history and mutation ordering retain their existing implementations.

Each page and traversal observes current database state. Concurrent changes can move inbox rows between pages, and a long export is not a transaction snapshot. Cursor traversal has bounded batch hydration; total work still grows with company size. The legacy compatibility response is intentionally unbounded.
