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

## Company workspace modules

The deployed workspace separates client presentation from server orchestration:

| Area | Path | Responsibility |
| --- | --- | --- |
| Screen orchestration | `app/company-workspace/workspace.tsx` | Company/request selection, shared screen state, mutations and focus transitions |
| Feature components | `app/company-workspace/components/` | Inbox, intake, AI findings, review editors, work packages, effort display, commitment tracking, configuration and knowledge |
| Shared presentation | `app/company-workspace/ui.tsx`, `request-presentation.ts`, `workspace-navigation.ts` | Tailwind primitives, request labels and navigation definitions |
| Review state | `app/company-workspace/review-state.ts` | Derived review questions, finding decisions and scope blockers for the editor |
| Client transport | `app/company-workspace/workspace-api.ts` | Existing JSON/multipart workspace requests and response errors |
| Server orchestration | `lib/client-workflow.ts` | Company access, action dispatch, persistence, concurrency checks and audit ordering |
| Input validation | `lib/workflow-validation.ts` | Action and AI-output schemas, including existing limits and defaults |
| AI analysis | `lib/workflow-analysis.ts` | Structured output, source verification and conversion into provisional review scope |
| Planning | `lib/workflow-planning.ts` | Configured task effort, eligible training-history adjustments and server scope-readiness checks |
| Company defaults | `lib/workflow-defaults.ts` | Fresh default configuration for each new company |

Backend routes and webhooks continue to import orchestration from `lib/client-workflow.ts`. Client components must not import the server analysis, storage, or credential modules. Keep the server's role, version, review and holdout checks authoritative; the editor's derived state only explains those requirements to a person.

This module split does not merge the Sites runtime with `apps/web` or the Go/Python services. It changes neither the stored record format nor API actions and requires no data migration. Reverting the refactor restores the previous source layout without a database rollback. See [the refactoring notes](workspace-refactoring.md) for review boundaries and follow-up work.
