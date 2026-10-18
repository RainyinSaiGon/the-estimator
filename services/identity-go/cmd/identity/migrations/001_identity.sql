CREATE TABLE IF NOT EXISTS identity_accounts (
    id UUID PRIMARY KEY,
    email_normalized TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_salt BYTEA NOT NULL,
    password_hash BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity_sessions (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES identity_accounts(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS identity_sessions_account_idx ON identity_sessions(account_id);
CREATE INDEX IF NOT EXISTS identity_sessions_expiry_idx ON identity_sessions(expires_at);

CREATE TABLE IF NOT EXISTS identity_login_attempts (
    email_key_hash BYTEA PRIMARY KEY CHECK (octet_length(email_key_hash) = 32),
    window_started_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identity_login_attempts_updated_idx ON identity_login_attempts(updated_at);
