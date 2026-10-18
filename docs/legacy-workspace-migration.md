# Legacy workspace migration

The Go estimator owns private project records. The migration command is for a reviewed local or isolated candidate run only. No production export, write, or traffic cutover is authorized by this tooling.

## Inputs

Export one project per JSONL row:

```json
{"ownerId":"legacy-owner-key","recordId":"stable-project-id","project":{"title":"Example","brief":"...","scope":{},"versions":[],"actuals":null}}
```

Take a consistent source snapshot. Keep it unchanged and retain its checksum. Owner mapping uses `owner-map.json` with an explicit mapping for every owner:

```json
{"mappings":[{"legacyOwnerId":"legacy-owner-key","firstPartyAccountId":"00000000-0000-4000-8000-000000000001","reviewerId":"00000000-0000-4000-8000-000000000002","reviewedAt":"2026-10-18T12:00:00Z","reason":"Account owner verified through the approved linking process."}]}
```

The mapping file contains account and reviewer IDs only; email matching is not supported. Obtain these IDs and the review record through the approved account-linking process. The importer refuses missing mappings, duplicate owners, invalid IDs, absent briefs, and projects without a frozen estimate.

## Dry run and import

Dry run parses, maps, converts, and validates rows without opening a database connection:

```powershell
Set-Location services/estimator-go
go run ./cmd/estimator migrate-legacy --input export.jsonl --owner-map owner-map.json
```

Keep the shell in this module directory for the remaining commands; input and mapping paths are relative to it.

It prints source, imported, skipped, rejected, and reason counts. Eligible rows appear under `eligible_dry_run`; no records are written. Compare the source count to the export independently, review every rejection and mapping, then run against a disposable local PostgreSQL database:

```powershell
$env:ESTIMATOR_ALLOW_LEGACY_IMPORT = 'true'
go run ./cmd/estimator migrate-legacy --input export.jsonl --owner-map owner-map.json --apply
```

The extra environment gate is required for writes. Each record is encrypted and committed together with a migration-ledger entry. Stable source IDs make retries idempotent. An identical imported row is skipped; a changed source row under the same migration key is rejected for review. Historical snapshots and actuals remain in the encrypted `legacyImport.originalProject` archive and keep their original synthetic labels; their learning provenance remains `legacy-unknown` and they are not automatically calibration eligible.

Rollback removes only records with ledger entries derived from the supplied source IDs. The original export is never changed:

```powershell
go run ./cmd/estimator migrate-legacy --input export.jsonl --owner-map owner-map.json --apply --rollback
```

After rollback, rerun dry-run and reconcile the database and ledger against the unchanged source export. Do not begin a hosted import, production write, identity reassignment, or traffic cutover without the separate review required by Epic #19.
