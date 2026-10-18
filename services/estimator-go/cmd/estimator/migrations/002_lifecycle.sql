ALTER TABLE estimator_records
    DROP CONSTRAINT IF EXISTS estimator_records_schema_version_check;

ALTER TABLE estimator_records
    ADD CONSTRAINT estimator_records_schema_version_check CHECK (schema_version IN (1, 2));

CREATE TABLE IF NOT EXISTS estimator_migration_ledger (
    migration_key TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    owner_key CHAR(64) NOT NULL,
    record_id UUID NOT NULL REFERENCES estimator_records(id) ON DELETE CASCADE,
    source_digest CHAR(64) NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    mapping_reviewer TEXT NOT NULL,
    mapping_reviewed_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE estimator_migration_ledger
    ADD COLUMN IF NOT EXISTS imported_record_digest CHAR(64);

CREATE INDEX IF NOT EXISTS estimator_migration_ledger_source_idx
    ON estimator_migration_ledger (source_id);
