CREATE TABLE IF NOT EXISTS workflow_companies (
  id uuid PRIMARY KEY,
  nonce bytea NOT NULL,
  ciphertext bytea NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workflow_members (
  company_id uuid NOT NULL REFERENCES workflow_companies(id) ON DELETE CASCADE,
  account_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','reviewer','member')),
  PRIMARY KEY (company_id,account_key)
);
CREATE INDEX IF NOT EXISTS workflow_member_account ON workflow_members(account_key);
CREATE TABLE IF NOT EXISTS workflow_attachments (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES workflow_companies(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  nonce bytea NOT NULL,
  ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_attachment_request ON workflow_attachments(company_id,request_id);
