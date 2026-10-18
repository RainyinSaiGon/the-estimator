# First-party identity service

This Go service owns local account credentials and revocable browser sessions. It does not store estimator requests or delivery records. The Next.js BFF is its browser-facing boundary; the service is internal-only in Compose.

## Local endpoints

- GET /health/live and GET /health/ready
- POST /v1/accounts creates an account and its first session.
- POST /v1/sessions checks email/password and creates a session.
- GET /v1/session resolves a valid opaque session token to its stable account ID.
- POST /v1/session/renew revokes the current token and returns a replacement session token.
- DELETE /v1/session revokes the session.
- Account registration returns a uniform accepted response for new and existing addresses, sends a verification link when eligible, and creates no usable password or session. The mailbox owner supplies the initial password when completing the link.
- POST /v1/email-verifications/complete consumes a one-use verification token, sets the initial password, and creates the first session.
- POST /v1/password-recovery-requests sends a recovery link without disclosing account state.
- POST /v1/password-recoveries consumes a one-use token, replaces the password, and revokes all account sessions.

Every versioned route requires the shared X-Identity-BFF-Secret. Session operations also require the opaque bearer token. The browser never receives the service secret. The BFF places the returned session token in an HttpOnly cookie and does not return the bearer token to client code.

The account key is a random UUID. Passwords use Argon2id with a unique random salt; raw passwords are not stored. Session tokens are generated with crypto/rand; only their SHA-256 digests are persisted. Session renewal rotates the token, revokes the previous token in the same database transaction, and preserves a 30-day absolute lifetime for that sign-in. Renewal is allowed only while the current session is active and the absolute lifetime has more than one minute remaining. Existing sessions receive their current expiry as the migration-time absolute limit. PostgreSQL is dedicated to this service.

Sign-in attempts are throttled in PostgreSQL by a domain-separated HMAC of the normalized account email, so limits are shared across service replicas without storing the email in the throttle table. Five attempts are allowed in a ten-minute window; the next request is rejected for ten minutes. A successful sign-in clears that account's counter. A background cleanup removes inactive throttle rows after 24 hours. This is an account-level password-guessing control, not an IP or registration abuse limit; public deployments also need edge rate limits and abuse monitoring.

## Configuration

Supply IDENTITY_DATABASE_URL, IDENTITY_BFF_SHARED_SECRET (at least 32 bytes), and optionally IDENTITY_SESSION_TTL through the service environment or a secret manager. Do not commit local .env.local files or expose these settings with NEXT_PUBLIC_ or VITE_ prefixes. Do not publish port 8003 to the host.

`contracts/v1/identity-openapi.json` v1.1 defines registration, sessions, email verification, password recovery, throttling, and the email-delivery boundary. New accounts start unverified, without a usable password or session; the mailbox owner sets the password while completing verification. The web BFF refuses private-record tokens for unverified accounts, and the Go record service independently requires `email_verified: true` in its validated service token. The identity service locks and rechecks the password verifier before creating a sign-in session, serializing sign-in with recovery's account lock. The policy is `IDENTITY_EMAIL_MODE=disabled|smtp`; disabled is the default and makes email actions unavailable while leaving private records blocked. SMTP mode requires `IDENTITY_SMTP_HOST`, `IDENTITY_SMTP_PORT`, `IDENTITY_SMTP_FROM`, `IDENTITY_SMTP_USERNAME`, and `IDENTITY_SMTP_PASSWORD`. Every message uses STARTTLS with normal certificate and hostname verification. An optional `IDENTITY_SMTP_CA_FILE` adds a local CA for the test sink; it does not disable verification. `IDENTITY_PUBLIC_BASE_URL` selects the link origin and defaults to `http://localhost:3000` (plain HTTP is accepted only for localhost). Verification tokens are random, single-use, stored only as SHA-256 digests, and expire after 24 hours. Recovery tokens follow the same rules and expire after 30 minutes; successful reset changes the Argon2id password hash and revokes all active sessions in one transaction. Recovery requests have the same accepted response for known, unknown, and unverified accounts; account-level and pseudonymous request-level throttles are stored without raw email addresses or IP addresses.

This implementation is a local prototype, not production identity. It still lacks MFA, comprehensive IP/registration abuse controls, security monitoring, durable email delivery, and a reviewed account migration. Do not use it for production or real client data until those controls and the session design have been independently reviewed.
