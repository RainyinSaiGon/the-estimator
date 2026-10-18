# ADR 0002: Production runtime, identity, and data ownership

- Status: accepted for migration planning; identity choice superseded locally by ADR 0003; no deployment or production cutover authorized
- Date: 2026-10-17
- Related: [Epic #4](https://github.com/RainyinSaiGon/the-estimator/issues/4), [ADR 0001](0001-next-go-python-first-slice.md)

## Context

The first Next.js/Go/Python slice runs locally and is intentionally ephemeral. The live app remains on OpenAI Sites, where its server reads trusted `oai-authenticated-user-id` and related identity headers. The new preview has no user authentication, durable records, or service authentication. The hackathon deadline is 19 October 2026, so the existing deployment remains the safe judge-facing fallback through submission.

Any future host change must keep the public overview available while isolating each signed-in user's workspaces. Moving the web app away from OpenAI Sites also moves it away from the identity headers that the legacy app currently trusts. No account-linking or migration mechanism is implemented yet.

## Decisions

### Runtime and network

- Keep the current OpenAI Sites deployment and its data path as production through the hackathon. This ADR does not provision services, alter DNS, expose APIs, or switch traffic.
- Recommend Railway as the post-hackathon hosting target for one Next.js web/BFF service, one Go estimator service, one Python brief service, and PostgreSQL. The services can use their existing Dockerfiles; only the web service should have a public domain. Keep Go, Python, and PostgreSQL on the platform's private network.
- Treat Railway as a recommendation pending an account, region, cost, and identity-provider review. Railway's private network is defense in depth; it does not replace application authentication or per-user authorization.
- Keep the deployment reversible. Do not change the judge URL until identity, data import, owner isolation, the complete workflow, and rollback have been exercised against the candidate deployment.

Railway documents Dockerfile-backed services, private service DNS/networking, and PostgreSQL services that are private by default. See [Services](https://docs.railway.com/services), [Private Networking](https://docs.railway.com/networking/private-networking), and [PostgreSQL](https://docs.railway.com/databases/postgresql).

### Historical user identity and service authentication proposal (superseded locally)

> Historical local identity proposal. The OIDC approach below was superseded by ADR 0003 on 2026-10-18. The local preview now uses its first-party Go identity service; hosted identity and D1 data remain unchanged.

- This ADR originally proposed an OIDC-compatible login and issuer/subject mapping. That implementation has been removed from the local preview in favor of the first-party identity service described by ADR 0003. No local compatibility or owner-migration path remains.
- The Next.js BFF validates the browser session and issues a short-lived, audience-limited token for Go. Go validates the token and authorizes every record operation against the internal account ID. Do not trust browser-supplied owner IDs or unsigned identity headers.
- Go authenticates its calls to Python with a distinct service credential and audience. Python accepts only brief-analysis requests and has no authority to read or write project records. Rotate credentials through runtime secret configuration; keep them out of the repository and browser bundle.
- Before importing workspaces, build an explicit mapping from each legacy Sites owner ID to an internal account ID. Do not silently match owners by email. If an owner cannot be mapped and verified, hold that owner's records out of the new workspace until an account-linking path exists.

### Data ownership and migration

- Go owns the project datastore. PostgreSQL is the target store; only the Go service writes project, estimate, frozen-baseline, delivery, and history records. The web app and Python service have no direct database credentials.
- Keep existing D1 as the source of truth until migration begins. Export a consistent snapshot, preserve stable record IDs and original owner IDs, and import idempotently into PostgreSQL. Frozen baseline values and source briefs must be preserved exactly; imported synthetic examples must remain labelled synthetic.
- Reconcile source/import counts, rejects, owner mappings, and frozen baseline values before enabling writes on the new stack. Keep a restorable D1 snapshot and an export of the new store for the agreed rollback window.
- For rollback after new writes begin, stop writes, export the post-cutover delta, reconcile it against the legacy schema, then restore the old route. If that reverse export cannot be proven safe, do not begin production writes on the new stack.

### Client briefs and optional AI

- Hosted AI remains disabled and unconfigured. The sample parser is the only available parser until the owner separately configures a provider.
- Do not persist client brief text in the Python service. Exclude request bodies and source passages from application logs and traces; log request IDs, timings, outcomes, and safe validation metadata only.
- Before enabling an external model, require an explicit user action, send only the minimum necessary text, document provider retention/training settings, and provide a way to redact sensitive details. Provider-specific data handling remains a release gate.

## Consequences

- The architecture has clear data ownership, service-authentication, encrypted-content, retention, and deletion boundaries. The local private-record path is opt-in and disabled until its runtime configuration is complete.
- The local OIDC proposal is superseded by ADR 0003. Moving hosted accounts or records away from the current Sites identity system still requires a separately approved, explicit identity and data-mapping plan.
- Railway is a technically suitable target for a containerized preview, but it is not provisioned or production-approved by this ADR. Recheck its cost, region, account access, and operational requirements before deployment.
- The live Site remains the fallback until the P3 cutover checklist in Epic #4 passes. The local Compose stack remains the development environment.

## Follow-up gates

1. Validate first-party session expiry/revocation and two-user isolation locally; any future hosted identity or D1 migration needs a separately approved, explicit plan.
2. Validate Go-owned PostgreSQL persistence, encryption, retention, deletion, and repeatable D1 export/import with reconciliation and rollback evidence against an isolated candidate environment.
3. Deploy to an isolated Railway environment only after reviewing account, region, and cost. Keep all service and database endpoints private except the web entry point.
4. Keep production AI disabled until provider data-handling settings and explicit user consent are verified.
