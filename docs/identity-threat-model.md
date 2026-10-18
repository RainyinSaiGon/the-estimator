# First-party identity threat model

**Status:** Local preview only. This document records the controls and known gaps in the prototype; it is not an independent security review or production approval.

## Assets and trust boundaries

- Identity PostgreSQL stores account email, display name, Argon2id password verifiers, hashed opaque session tokens, absolute and idle expiry, revocation state, and keyed login-throttle identifiers.
- The Next.js BFF is the browser boundary. It keeps the opaque identity session in an HttpOnly, SameSite cookie and never returns internal service credentials or service tokens to browser code.
- The Go identity service owns account credentials and sessions. Only the BFF can call its versioned account/session endpoints using the shared internal secret.
- The Go estimator service owns private-record PostgreSQL, owner mappings, and record encryption. The BFF exchanges the verified first-party account ID for a short-lived, audience-bound token with an operation-specific scope.
- Python brief analysis has no identity database, session, or private-record credentials. The public hosted Site and its existing login path are outside this local preview.

## Threats and current controls

| Threat | Prototype control | Limit |
| --- | --- | --- |
| Password disclosure after database read | Argon2id with a unique random salt; raw passwords are not persisted | No independent review or credential breach monitoring |
| Password guessing | Persistent account-keyed HMAC throttle; five attempts per ten-minute window then a ten-minute block; constant-work unknown-account verification | No edge/IP controls, registration throttling, or distributed abuse monitoring |
| Stolen or replayed browser session | 256-bit opaque token; only SHA-256 digest stored; HttpOnly, SameSite cookie; idle and 30-day absolute expiry; rotation revokes the prior token; sign-out revokes the current token | No MFA, device management, or user-visible session inventory |
| CSRF against state-changing browser routes | BFF checks request Origin against the request host; cross-site fetch metadata is rejected on record mutations | Deployment must preserve correct host/proxy headers and HTTPS settings |
| Forged identity, wrong service, or over-broad service call | HS256 signature, issuer, audience, time bounds, stable internal account UUID, `kid`, and exact operation scope are checked by Go | Shared HMAC keys require secure distribution; there is no asymmetric key infrastructure or external rotation service |
| Cross-account record access | Go resolves owner identity server-side; all record queries are owner-scoped; record contents and titles use AES-256-GCM; owner indexes use a separate HMAC key | The two-account check is synthetic local evidence, not a penetration test or production data validation |
| Sensitive values in logs or AI requests | Request logs omit bodies, cookies, tokens, and query strings; Python has no identity/record credentials | Operational log sinks and model-provider settings still need deployment review |
| Database or service outage | Bounded requests, readiness checks, database connection limits, and generic errors | Backups, restore drills, and production incident response have not been exercised |

## Recovery and account lifecycle

Email verification and password recovery are deliberately unavailable. There is no recovery endpoint or email-delivery provider configured, so a user who loses a local password cannot self-recover the account. Do not use the local preview for real client data or as a durable production account. Before enabling public registration, choose and review an email-delivery path, implement single-use expiring recovery tokens with uniform responses and throttling, and define verification, revocation, audit, and support procedures. Never provide recovery by matching an email address to a legacy provider account.

## Key handling and rotation

- `SERVICE_TOKEN_SECRET` is shared only between the BFF and estimator service. Tokens expire after 60 seconds, include `kid`, audience, issuer, `jti`, and exactly one private-record operation scope. During rotation, the Go service accepts the active key plus up to eight previous key IDs through `SERVICE_TOKEN_VERIFICATION_KEYS`; retain old verification entries for at least two minutes after both services use the new key. Keep `legacy` available during the first rotation for already-issued tokens without a key ID.
- `IDENTITY_BFF_SHARED_SECRET` is separate from every other secret. Rotate it as a coordinated BFF/identity deployment; the prototype has no overlapping-key mechanism for it.
- `CLIENT_CONTENT_KEY` must remain available to decrypt saved records. Rotation requires a reviewed and verified re-encryption migration before old key material can be removed.
- `IDENTITY_INDEX_KEY` must remain stable while owner mappings exist. Rotation requires a reviewed index rebuild that preserves ownership.
- Keep values in ignored local configuration or an approved runtime secret manager. Never commit them, expose them in `NEXT_PUBLIC_*`, or include them in telemetry or AI prompts.

## Retention, migration, and rollback

Private records expire after 90 days by default (configurable from 1 to 3650 days); expired ciphertext is excluded immediately and cleanup runs every six hours. Deletion is owner-scoped. Identity account and session cleanup/retention still needs a separate operational policy before public use.

Legacy workspace migration requires an active first-party session and a verified session from the previous OIDC provider. It does not match by email and re-encrypts records transactionally when account IDs differ. Keep the legacy callback and configuration until each affected owner confirms their records; missing legacy keys mean migration cannot be claimed complete. The identity service is local preview code: do not cut over the hosted Site or delete the legacy migration path until migration, rollback, and independent security review gates pass.

## Production gates

1. Define verified email and safe password recovery, registration and edge abuse controls, monitoring, account/session retention, backups, and restore procedures.
2. Independently review the identity, session, token, database, and key-management design; test failure and compromise recovery.
3. Rehearse a documented legacy mapping and rollback using the actual retained legacy configuration and keys, without email-based linking.
4. Re-run two-account isolation and session tests in the deployment environment, then seek separate approval before any hosted deployment or traffic change.
