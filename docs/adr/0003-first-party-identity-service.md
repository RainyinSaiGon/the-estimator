# ADR 0003: First-party identity and authorization service

- Status: Accepted for the local prototype; production use is not approved
- Date: 2026-10-18
- Related: [Epic #26](https://github.com/RainyinSaiGon/the-estimator/issues/26), [Epic #19](https://github.com/RainyinSaiGon/the-estimator/issues/19), [ADR 0002](0002-production-runtime-identity-and-data.md)

## Context

The P1 private-record implementation in [PR #25](https://github.com/RainyinSaiGon/the-estimator/pull/25) uses a generic OIDC client in Next.js, configured locally with Auth0. The user wants The Estimator to own account authentication and authorization instead of depending on an external identity tenant. Private estimates still need a server-verified account identity, revocable browser sessions, and owner-scoped access in Go. The production Site and its existing sign-in flow must remain available during this migration.

## Decision

- Add a standalone Go identity service with a dedicated identity datastore. It owns accounts, credential verifiers, and revocable browser sessions. The identity service does not read or write estimate records.
- Use a first-party email/password login for the initial local slice. Use Argon2id through the maintained Go `x/crypto` package with a unique random salt and parameters no weaker than the current OWASP Password Storage Cheat Sheet minimum. Benchmark on the target service before raising parameters.
- Generate opaque session secrets with Go `crypto/rand`; persist only a one-way hash of each random session secret, along with account ID, expiry, and revocation state. The random token is not a password and does not need a slow password hash.
- The Next.js BFF proxies registration, sign-in, sign-out, and session checks. It sets an HttpOnly, SameSite cookie with `Secure` in deployed HTTPS environments, no `Domain`, a bounded lifetime, and no token in browser-readable storage. The browser never receives a service token.
- The BFF and trusted Go services resolve a valid browser session to the stable internal account ID through the authenticated identity API. Each service must authorize every owner-scoped operation against that ID. Python receives no identity database access or private-record authority.
- Start with account-owner authorization only. Do not add organization roles or delegated access until a product workflow requires them.
- Keep account recovery and email verification unavailable in the local prototype until an email-delivery path is designed. This limitation blocks production use; the local service must say so clearly.
- Remove the external OIDC provider configuration and callback code only after the first-party sign-in and two-account record-isolation checks pass. Preserve existing records and account ownership through an explicit migration; never auto-link by email.
- Keep the public Site and its existing authentication path unchanged. This ADR does not authorize a production deployment, data migration, or traffic cutover.

## Options considered

### Keep the managed OIDC provider

**Pros:** Mature account flows and standards support with less application code.

**Cons:** The identity authority and availability remain dependent on an external tenant, contrary to the requested first-party ownership.

### Self-host an existing identity provider

**Pros:** Own the runtime and user store while relying on a dedicated provider implementation for protocol behavior.

**Cons:** Adds an independently operated product and login/consent integration. It still requires a decision about which system owns account records and authorization policy.

### Build a Go identity service using established cryptographic primitives

**Pros:** Fits the existing Go microservice boundary, directly owns account/session state, and avoids an external identity tenant.

**Cons:** The team assumes responsibility for account lifecycle, credential abuse controls, session security, recovery, operational monitoring, and security review. It is not production-ready until those controls are complete.

## Consequences

- Auth0 client credentials are no longer required for new local accounts once the replacement is integrated.
- Identity schema and session operations become a separately deployed service with its own database credentials and migrations.
- Go record ownership can move from external `(issuer, subject)` claims to a stable internal account ID after explicit mapping.
- Email verification, password recovery, MFA, and organization membership remain unresolved product/security work and block production use.
- The initial service-level sign-in and account view do not persist estimates. Connecting private-record storage and migrating existing owner identities remain follow-up work.
- The existing `apps/web/auth.ts` OIDC client can be removed if the first-party session API fully replaces it; any reused standards-based code must remain generic and documented.

## Action items

1. [ ] Confirm this ADR and the local account lifecycle before production use.
2. [ ] Implement the identity service and versioned BFF contract.
3. [ ] Validate session expiry/revocation and two-account access isolation in an isolated environment.
4. [ ] Define email verification/recovery and account-migration procedures.
5. [ ] Remove the obsolete provider integration after replacement parity is proven.

## References

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Go `crypto/rand` documentation](https://pkg.go.dev/crypto/rand)
- [Go `x/crypto/argon2` package](https://pkg.go.dev/golang.org/x/crypto/argon2)
