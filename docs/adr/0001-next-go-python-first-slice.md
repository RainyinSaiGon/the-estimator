# ADR 0001: Native Next.js app with Go and Python service boundaries

- Status: accepted for the first migration slice
- Date: 2026-10-17
- Related: [Epic #4](https://github.com/RainyinSaiGon/the-estimator/issues/4), [Task #5](https://github.com/RainyinSaiGon/the-estimator/issues/5)

## Context

The existing public demo is a working Sites application backed by a TypeScript/Cloudflare implementation. The hackathon has four days remaining. Replacing its production runtime now would put the submission at avoidable risk. The first slice must demonstrate the requested stack without moving production traffic or claiming unprovisioned AI, authentication, or durable storage.

## Decision

- Keep the existing deployment and data path available through the `*:legacy` commands. The new root `dev`, `build`, and `start` commands run the native Next.js application in `apps/web`.
- Next.js owns the browser UI and the same-origin backend-for-frontend route. The BFF validates the request, calls internal services with bounded timeouts, and returns one preview response.
- The Python FastAPI service owns brief parsing and source-grounded scope extraction. It has no database and only exposes the deterministic sample parser in this slice. AI mode returns an explicit unavailable response.
- The Go service owns deterministic task estimation, synthetic demonstration-history matching, uncertainty ranges, blockers, and estimation provenance. It has no database in this slice.
- The service contract is versioned JSON over HTTP. Docker Compose supplies the local network; only the Next.js port is published to loopback. A message broker is deferred until asynchronous work exists.
- The preview is ephemeral, accepts fictional or user-supplied text only for the immediate request, and persists nothing. Authentication, user workspaces, real historical actuals, and database ownership are later migration work.

## Consequences

- A single local command starts all three independently built services. Service ownership is testable through separate health and versioned API endpoints.
- The UI and service contracts can evolve without coupling Python parsing to Go estimation data structures.
- The current deployed app remains the submission path while this architecture is reviewed. This branch does not change hosting configuration or production audience.
- Before public cutover, follow-up work must select identity, durable data ownership and migration, deployment topology, request limits, and service-to-service security. The temporary loopback Compose deployment is a development/demo boundary, not a production security design.
- The first implementation intentionally uses synthetic examples and rule-based extraction. It does not establish estimate accuracy or AI-backed extraction quality.
