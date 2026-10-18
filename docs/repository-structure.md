# Repository structure

The repository contains the deployed Sites app and a separate local service preview. Their source trees stay separate because each has its own runtime, routing, and storage path.

```text
app/                       Existing Sites app routes and screens
components/ hooks/ lib/     Existing Sites app UI and domain code
db/ drizzle/                Existing Sites D1 schema and migrations

apps/web/                   Next.js app and server-side BFF
services/
  identity-go/              First-party identity, sessions, verification
  estimator-go/             Estimates, private records, delivery outcomes
  brief-intelligence/       Python extraction and optional agent analysis

contracts/v1/               OpenAPI contracts for service boundaries
evaluation/                 Scoping candidates, rubric, and evaluators
tests/                      Existing Sites app tests
scripts/                    Local development and validation tools
docs/                       Guides, architecture decisions, and operations
examples/                   Standalone examples
build/                      Sites and preview build integrations
vendor/                     Vendored build/runtime dependencies
```

The root `package.json` owns shared JavaScript dependencies and delegates `dev`, `build`, and `start` to `apps/web`. Its `*:legacy` commands use the root Sites app. The Python and Go services keep their own manifests and container definitions under `services/`.

Keep changes with the runtime that owns them: Sites UI and D1 behavior in the root folders; new preview routes and BFF code in `apps/web`; identity, estimation, and extraction logic in their corresponding service folders. Contract changes belong in `contracts/` and must match the owning service.
