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
