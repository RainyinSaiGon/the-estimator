# First-party identity service

This Go service owns local account credentials and revocable browser sessions. It does not store estimator requests or delivery records. The Next.js BFF is its browser-facing boundary; the service is internal-only in Compose.

## Local endpoints

- GET /health/live and GET /health/ready
- POST /v1/accounts creates an account and its first session.
- POST /v1/sessions checks email/password and creates a session.
- GET /v1/session resolves a valid opaque session token to its stable account ID.
- POST /v1/session/renew revokes the current token and returns a replacement session token.
- DELETE /v1/session revokes the session.

Every versioned route requires the shared X-Identity-BFF-Secret. Session operations also require the opaque bearer token. The browser never receives the service secret. The BFF places the returned session token in an HttpOnly cookie and does not return the bearer token to client code.

The account key is a random UUID. Passwords use Argon2id with a unique random salt; raw passwords are not stored. Session tokens are generated with crypto/rand; only their SHA-256 digests are persisted. Session renewal rotates the token, revokes the previous token in the same database transaction, and preserves a 30-day absolute lifetime for that sign-in. Renewal is allowed only while the current session is active and the absolute lifetime has more than one minute remaining. Existing sessions receive their current expiry as the migration-time absolute limit. PostgreSQL is dedicated to this service.

Sign-in attempts are throttled in PostgreSQL by a domain-separated HMAC of the normalized account email, so limits are shared across service replicas without storing the email in the throttle table. Five attempts are allowed in a ten-minute window; the next request is rejected for ten minutes. A successful sign-in clears that account's counter. A background cleanup removes inactive throttle rows after 24 hours. This is an account-level password-guessing control, not an IP or registration abuse limit; public deployments also need edge rate limits and abuse monitoring.

## Configuration

Supply IDENTITY_DATABASE_URL, IDENTITY_BFF_SHARED_SECRET (at least 32 bytes), and optionally IDENTITY_SESSION_TTL through the service environment or a secret manager. Do not commit local .env.local files or expose these settings with NEXT_PUBLIC_ or VITE_ prefixes. Do not publish port 8003 to the host.

`contracts/v1/identity-openapi.json` v1.1 defines the next lifecycle increment: unverified account registration, email verification, password recovery, throttling, and the email-delivery boundary. Those new routes and the verified-account gate are contract-first and are not implemented by this service yet; issue #29 tracks implementation. The accepted policy is `IDENTITY_EMAIL_MODE=disabled|smtp`. Disabled mode is local-preview-only and must block private-record token issuance. SMTP mode requires host, port, sender, username, and password settings and must use STARTTLS with certificate verification. Verification tokens are single-use with a 24-hour lifetime; recovery tokens are single-use with a 30-minute lifetime; a password reset revokes all active sessions. Recovery requests return a uniform response regardless of account existence.

This implementation is a local prototype, not production identity. It still lacks verified email, account recovery, MFA, IP/registration abuse limits, security monitoring, and a reviewed account migration. Do not use it for production or real client data until those controls and the session design have been independently reviewed.
