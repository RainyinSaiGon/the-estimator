# First-party identity service

This Go service owns local account credentials and revocable browser sessions. It does not store estimator requests or delivery records. The Next.js BFF is its browser-facing boundary; the service is internal-only in Compose.

## Local endpoints

- GET /health/live and GET /health/ready
- POST /v1/accounts creates an account and its first session.
- POST /v1/sessions checks email/password and creates a session.
- GET /v1/session resolves a valid opaque session token to its stable account ID.
- DELETE /v1/session revokes the session.

Every versioned route requires the shared X-Identity-BFF-Secret. Session operations also require the opaque bearer token. The browser never receives the service secret. The BFF places the returned session token in an HttpOnly cookie and does not return the bearer token to client code.

The account key is a random UUID. Passwords use Argon2id with a unique random salt; raw passwords are not stored. Session tokens are generated with crypto/rand; only their SHA-256 digests are persisted. PostgreSQL is dedicated to this service.

## Configuration

Supply IDENTITY_DATABASE_URL, IDENTITY_BFF_SHARED_SECRET (at least 32 bytes), and optionally IDENTITY_SESSION_TTL through the service environment or a secret manager. Do not commit local .env.local files or expose these settings with NEXT_PUBLIC_ or VITE_ prefixes. Do not publish port 8003 to the host.

This implementation is a local prototype, not production identity. It currently lacks verified email, account recovery, MFA, durable/distributed abuse throttling, security monitoring, and a reviewed account migration. Do not use it for production or real client data until those controls and the session design have been independently reviewed.
