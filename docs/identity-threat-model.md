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
| Password guessing and registration abuse | Persistent account-keyed HMAC throttle; five sign-in attempts per ten-minute window then a ten-minute block; email-verification requests are limited by address and BFF-provided pseudonymous request key; constant-work unknown-account verification | No trusted edge/IP limits, distributed abuse monitoring, or independent abuse review |
| Stolen or replayed browser session | 256-bit opaque token; only SHA-256 digest stored; HttpOnly, SameSite cookie; idle and 30-day absolute expiry; rotation revokes the prior token; sign-out revokes the current token | No MFA, device management, or user-visible session inventory |
| CSRF against state-changing browser routes | BFF checks request Origin against the request host; cross-site fetch metadata is rejected on record mutations | Deployment must preserve correct host/proxy headers and HTTPS settings |
| Forged identity, wrong service, or over-broad service call | The maintained `golang-jwt/jwt/v5` parser enforces an HS256 allowlist, issuer, exactly one audience, expiry, and issue time; Go also checks the stable internal account UUID, `kid`, token lifetime (at most 60 seconds), and exact operation scope. `owner_id` claims are rejected so ownership comes only from `sub`; the BFF checks verified account state before issuing the token. | Shared HMAC keys require secure distribution; there is no asymmetric key infrastructure or external rotation service. |
| Cross-account record access or overwrite | Go resolves owner identity server-side; list/read/title-update/delete queries are owner-scoped; record contents and titles use AES-256-GCM; owner indexes use a separate HMAC key; title rename leaves reviewed scope and estimate frozen | The two-account check is synthetic local evidence, not a penetration test or production data validation |
| Sensitive values in logs or AI requests | Request logs omit bodies, cookies, tokens, and query strings; Python has no identity/record credentials | Operational log sinks and model-provider settings still need deployment review |
| Database or service outage | Bounded requests, readiness checks, database connection limits, and generic errors | Backups, restore drills, and production incident response have not been exercised |

## Recovery and account lifecycle

Registration returns the same accepted response for new, existing, and verified addresses. It creates an unverified account without a usable password or session; a duplicate pending registration can request another link within the same address throttle. The mailbox owner sets the initial password while consuming the single-use 24-hour verification token; completion invalidates any prior sessions and creates the first verified session. Sign-in is denied until both the email is verified and a password is set. Private-record service tokens are withheld until the identity service reports a verified email. Recovery tokens are single-use and expire after 30 minutes; reset revokes every active session. Only token digests are persisted. Recovery responses are uniform for known, unknown, and unverified addresses. Lifecycle flows have address and BFF-provided pseudonymous request throttles; they do not replace trusted edge/IP limits. Opening a verification link does not consume it; the user must submit the password form.

Email delivery is controlled by `IDENTITY_EMAIL_MODE=disabled|smtp`. `disabled` is local-preview-only: requests return a generic unavailable response and records stay blocked. `smtp` requires host, port, sender, and secret credentials and must use STARTTLS with certificate verification. The service must not reveal account existence if delivery is unavailable. Never recover an account by matching its email to a legacy provider account. Do not use the current prototype for real client data or as a durable production account.

## Key handling and rotation

- `SERVICE_TOKEN_SECRET` is shared only between the BFF and estimator service. Tokens expire after 60 seconds, include `kid`, audience, issuer, `jti`, and exactly one private-record operation scope (`read`, `create`, `update`, or `delete`). During rotation, the Go service accepts the active key plus up to eight previous key IDs through `SERVICE_TOKEN_VERIFICATION_KEYS`; retain old verification entries for at least two minutes after both services use the new key. Keep `legacy` available during the first rotation for already-issued tokens without a key ID.
- `IDENTITY_BFF_SHARED_SECRET` is separate from every other secret. Rotate it as a coordinated BFF/identity deployment; the prototype has no overlapping-key mechanism for it.
- `CLIENT_CONTENT_KEY` must remain available to decrypt saved records. Rotation requires a reviewed and verified re-encryption migration before old key material can be removed.
- `IDENTITY_INDEX_KEY` must remain stable while owner mappings exist. Rotation requires a reviewed index rebuild that preserves ownership.
- Keep values in ignored local configuration or an approved runtime secret manager. Never commit them, expose them in `NEXT_PUBLIC_*`, or include them in telemetry or AI prompts.

## Retention, migration, and rollback

Private records expire after 90 days by default (configurable from 1 to 3650 days); expired ciphertext is excluded immediately and cleanup runs every six hours. Deletion is owner-scoped. Identity account and session cleanup/retention still needs a separate operational policy before public use.

The temporary OIDC compatibility and workspace-migration path has been removed from the local preview. On 2026-10-18, the owner explicitly chose deletion of the sole old local encrypted record because its former provider configuration and encryption keys were unavailable. No hosted Site or D1 data was changed. The first-party identity service remains local preview code; this cleanup does not authorize a hosted cutover, account migration, or production use.

## Production gates

1. Add trusted edge/IP abuse controls, monitoring, account/session retention, backups, and restore procedures; locally verify the email flows against deployment ingress before any public use.
2. Independently review the identity, session, token, database, and key-management design; test failure and compromise recovery.
3. Rehearse a documented legacy mapping and rollback using the actual retained legacy configuration and keys, without email-based linking.
4. Re-run two-account isolation and session tests in the deployment environment, then seek separate approval before any hosted deployment or traffic change.
