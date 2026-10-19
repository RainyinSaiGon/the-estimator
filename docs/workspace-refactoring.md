# Workspace refactoring

Tracking: [issue #77](https://github.com/RainyinSaiGon/the-estimator/issues/77).

## Purpose

The deployed Sites workspace grew into a roughly 99 KB screen and a roughly 55 KB workflow module. Editing review controls, company settings, or AI validation required navigating unrelated UI and persistence code. This pass moves the existing implementations into focused modules and formats the touched code for review. It introduces no framework, runtime dependency, API action, database migration, or intended product behavior change.

## Where to make changes

- Change intake and list presentation in `app/company-workspace/components/request-intake.tsx` and `request-inbox.tsx`. Selection and form state remain owned by the screen, preserving draft and navigation behavior.
- Change AI finding display, scope review, review editors, and task proposals in `analysis-findings.tsx`, `scope-review.tsx`, `review-editors.tsx`, and `work-packages.tsx`. Corrections continue to be stored separately from the original analysis. The scope editor is controlled by its parent, so the extraction does not introduce a separate copy of review state.
- Change effort presentation in `effort-plan.tsx` and delivery progress controls in `commitment-tracking.tsx`. Committed scope still comes from the frozen baseline.
- Change company setup and knowledge-library panels in `company-configuration.tsx` and `company-knowledge.tsx`. Existing governance panels stay in `governance.tsx`.
- Change domain validation in `lib/workflow-validation.ts`, source-grounded AI processing in `workflow-analysis.ts`, and deterministic estimation/readiness rules in `workflow-planning.ts`.

Request-type choices now reuse the canonical domain enum. Shared `Field` and `Metric` primitives stay with the existing Tailwind UI contract. The extracted components use typed props and explicit callbacks; no new context store or state framework is introduced.

## Preservation boundaries

The following remain part of the existing server orchestration path:

- Role checks and owner/member access resolution.
- Expected-version checks and optimistic concurrency conditions.
- Database mutation/audit transaction ordering.
- Frozen baseline creation and immutability guards.
- Public-demo synthetic-cohort enforcement.
- Independent outcome review and training/holdout separation.
- Existing action payloads, validation limits/defaults, error responses and route imports.

The AI instructions, strict output shape, quote verification, task filtering, effort factors, rounding and training-history eligibility rules are moved without changing their implementation. UI state and review callbacks remain in the same parent; feature components render the existing markup and call those callbacks.

## Rollout and review

Review the changes as a module extraction plus formatting, with special attention to import boundaries, callback wiring, and conditional rendering. Compile the Sites production build and type-check both application trees. Existing tests remain available to CI; no new test suite or dependency is added by this pass. Do not treat compilation alone as proof of complete behavioral parity.

Publish through the repository's existing release process after review. Production rollout and changes to the public judge workspace are separate from this source refactor. Rollback requires reverting source commits, with no record migration.

## Follow-up boundaries

The separate Next.js workspace and Go workflow service also contain large modules, but their data and runtime contracts differ from Sites. Refactor them in separate changes rather than sharing storage or authorization implementations across runtimes. Further separation of the screen's asynchronous state orchestration and remaining screen layout can be reviewed independently after this first pass.
