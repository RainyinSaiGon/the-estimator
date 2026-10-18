ALTER TABLE identity_accounts
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE identity_accounts
    ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE identity_accounts SET password_set = FALSE WHERE email_verified = FALSE;

UPDATE identity_sessions
SET revoked_at = now()
WHERE revoked_at IS NULL
  AND account_id IN (SELECT id FROM identity_accounts WHERE email_verified = FALSE OR password_set = FALSE);

CREATE TABLE IF NOT EXISTS identity_lifecycle_tokens (
    token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    account_id UUID NOT NULL REFERENCES identity_accounts(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_recovery')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS identity_lifecycle_tokens_account_purpose_idx
    ON identity_lifecycle_tokens (account_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_lifecycle_tokens_expiry_idx
    ON identity_lifecycle_tokens (expires_at);

CREATE TABLE IF NOT EXISTS identity_lifecycle_attempts (
    key_hash BYTEA NOT NULL CHECK (octet_length(key_hash) = 32),
    purpose TEXT NOT NULL CHECK (purpose IN ('verification_request', 'verification_network', 'verification_complete', 'recovery_request', 'recovery_network', 'recovery_complete')),
    window_started_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (key_hash, purpose)
);

CREATE INDEX IF NOT EXISTS identity_lifecycle_attempts_updated_idx
    ON identity_lifecycle_attempts (updated_at);
