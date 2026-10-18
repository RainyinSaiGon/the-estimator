# ADR 0003: First-party identity and authorization service

- Status: Accepted for the local prototype; production use is not approved
- Date: 2026-10-18
- Related: [Epic #26](https://github.com/RainyinSaiGon/the-estimator/issues/26), [Epic #19](https://github.com/RainyinSaiGon/the-estimator/issues/19), [ADR 0002](0002-production-runtime-identity-and-data.md)

## Context

The P1 private-record implementation in [PR #25](https://github.com/RainyinSaiGon/the-estimator/pull/25) initially used a generic OIDC client in Next.js, configured locally with Auth0. The owner requested a first-party identity service and later explicitly chose to remove the OIDC integration and delete the only old local encrypted record because its former provider configuration and encryption keys were unavailable. The record and its account row were deleted from the old local database. No hosted Site or D1 data was changed. Private estimates still need a server-verified account identity, revocable browser sessions, and owner-scoped access in Go.

## Decision

- Add a standalone Go identity service with a dedicated identity datastore. It owns accounts, credential verifiers, and revocable browser sessions. The identity service does not read or write estimate records.
- Use a first-party email/password login for the initial local slice. Use Argon2id through the maintained Go `x/crypto` package with a unique random salt and parameters no weaker than the current OWASP Password Storage Cheat Sheet minimum. Benchmark on the target service before raising parameters.
- Generate opaque session secrets with Go `crypto/rand`; persist only a one-way hash of each random session secret, along with account ID, expiry, and revocation state. The random token is not a password and does not need a slow password hash.
- The Next.js BFF proxies registration, sign-in, sign-out, and session checks. It sets an HttpOnly, SameSite cookie with `Secure` in deployed HTTPS environments, no `Domain`, a bounded lifetime, and no token in browser-readable storage. The browser never receives a service token.
- Session renewal rotates the opaque token transactionally, revokes the prior token, extends the idle expiry, and caps each sign-in at a 30-day absolute lifetime. Renewal requires more than one minute to remain in that lifetime. A session already present when this rule is introduced cannot be extended beyond its existing expiry.
- The BFF and trusted Go services resolve a valid browser session to the stable internal account ID through the authenticated identity API. Each service must authorize every owner-scoped operation against that ID. Python receives no identity database access or private-record authority.
- The local BFF-to-estimator contract uses a short-lived HS256 JWT for one internal service call, not as a browser or user session token. Its protected header carries `kid`; claims are `iss=the-estimator-web`, `aud=the-estimator-go`, `sub=<stable account UUID>`, `identity_authority=first-party-v1`, `jti`, `iat`, `exp` (at most 60 seconds), and exactly one operation scope (`private-records:read`, `:create`, `:update`, or `:delete`). Go accepts only configured key IDs and validates all required claims before authorizing the route.
- Rotate the internal signing key by first configuring Go to verify both old and new key IDs, then switching the BFF signer, and removing the old key after at least two minutes. Keep the legacy key ID during the first rotation only for already-issued, short-lived tokens. This documents the existing local protocol; the custom Go JWT parser is a production gate and must be replaced with a maintained JWT validation library before production use.
- Start with account-owner authorization only. Do not add organization roles or delegated access until a product workflow requires them.
- Keep account recovery and email verification unavailable in the local prototype until an email-delivery path is designed. This limitation blocks production use; the local service must say so clearly.
- Persist sign-in throttling in the identity database using a keyed pseudonymous account identifier so limits are shared across replicas without storing raw email in the throttle table. This control does not replace edge/IP limits or registration abuse controls.
- Use first-party identity exclusively in the local preview. The legacy OIDC callback, configuration, token compatibility, and owner-migration path are removed. A future migration of hosted accounts or records requires a separately approved plan; do not infer ownership from email.
- Keep the public Site and its existing authentication path unchanged. This ADR does not authorize a production deployment, data migration, or traffic cutover.

## Options considered

### Keep the managed provider (rejected)

**Pros:** Mature account flows and standards support with less application code.

**Cons:** The identity authority and availability remain dependent on an external tenant, contrary to the requested first-party ownership. The old local migration record was deleted, so no OIDC migration compatibility is retained.

### Self-host an existing identity provider

**Pros:** Own the runtime and user store while relying on a dedicated provider implementation for protocol behavior.

**Cons:** Adds an independently operated product and login/consent integration. It still requires a decision about which system owns account records and authorization policy.

### Build a Go identity service using established cryptographic primitives

**Pros:** Fits the existing Go microservice boundary, directly owns account/session state, and avoids an external identity tenant.

**Cons:** The team assumes responsibility for account lifecycle, credential abuse controls, session security, recovery, operational monitoring, and security review. It is not production-ready until those controls are complete.

## Consequences

- Auth0 client credentials are not required by the first-party local preview.
- Identity schema and session operations become a separately deployed service with its own database credentials and migrations.
- Go private-record ownership is keyed by the stable first-party internal account ID. The removed external-provider identity is not accepted by local services.
- Email verification, password recovery, MFA, and organization membership remain unresolved product/security work and block production use.
- The current preview connects first-party accounts to private records through a short-lived BFF-to-Go principal. Go accepts only first-party account UUIDs; the prior OIDC claims and owner-migration operation are no longer supported.

## Action items

1. [ ] Confirm this ADR and the local account lifecycle before production use.
2. [x] Implement the identity service and versioned BFF contract.
3. [ ] Validate session expiry/revocation and two-account record access isolation in an isolated environment.
4. [ ] Define email verification/recovery and account-migration procedures.
5. [x] Remove the obsolete local provider integration after the owner chose deletion of the only legacy record. Hosted identity was not changed.

## References

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [First-party identity threat model and production gates](../identity-threat-model.md)
- [Go `crypto/rand` documentation](https://pkg.go.dev/crypto/rand)
- [Go `x/crypto/argon2` package](https://pkg.go.dev/golang.org/x/crypto/argon2)
