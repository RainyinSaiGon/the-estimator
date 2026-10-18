CREATE TABLE IF NOT EXISTS estimator_accounts (
    id UUID PRIMARY KEY,
    owner_key CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_key)
);

CREATE TABLE IF NOT EXISTS estimator_records (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES estimator_accounts(id) ON DELETE CASCADE,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    title_nonce BYTEA NOT NULL,
    title_ciphertext BYTEA NOT NULL,
    content_nonce BYTEA NOT NULL,
    content_ciphertext BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS estimator_records_owner_created_idx
    ON estimator_records (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS estimator_records_expiration_idx
    ON estimator_records (expires_at);
