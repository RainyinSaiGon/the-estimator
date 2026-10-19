# Sites UI review

The hosted application is the root `app/` Sites application. The separate
`apps/web` service application is not deployed at the current Sites URL.

## Visual contract

- Follow the established restrained, ElevenLabs-inspired direction: clean sans
  typography, generous space, fine neutral borders, rounded controls and a small
  lime brand accent.
- Share company controls through `app/company-workspace/ui.tsx`. Use Tailwind
  utilities and estimator theme tokens; no component stylesheet is required.
- Keep the company shell centered at a maximum width of 1280px. Center setup and
  empty states in the available content area; preserve space for the footer.
- Keep primary actions filled and distinguish secondary actions, selection,
  disabled controls, focus, loading, errors and success notices.
- Keep Requests and Evaluate as the primary navigation. Put Knowledge sources,
  Company settings, Members, Connectors and Audit in the grouped Workspace settings menu. At phone widths,
  wrap the two primary actions and keep the menu inside the viewport.
- Keep long IDs, hashes, source passages and task names inside their cards.
  Wide estimate tables scroll inside their own container.

## Verification coverage

Browser review uses fictional local data and explicitly synthetic hosted test
requests. It does not establish recorded delivery performance.

Public-mode review also checks the anonymous shared-workspace warning, synthetic
cohort enforcement, public-only credential disclosures, and demo-specific content
on Requests, Knowledge sources, Company settings, Members, Connectors, Evaluate
and Audit. Tracking edits are checked against the frozen baseline digest.

| Surface | Coverage |
| --- | --- |
| Company sign-in, loading, empty and create states | Centering, typography, primary action and form layout |
| Company Requests | Focused searchable inbox, full-page detail/back navigation, intake, multi-file extraction, analysis evidence, provisional editable work packages, scope gates, per-task effort, immutable baseline and task-level commitment tracking |
| Knowledge sources | Source form, draft/approved library and provenance wrapping |
| Company settings | Versioned configuration fields and save controls |
| Members | Account ID, role descriptions and member form |
| Connectors | Demo credential rotation and revocation, signed webhook instructions, and root `/mcp` discovery instructions |
| Evaluate | Warnings, separate recorded/synthetic cards and export controls |
| Audit | Event layout and long identity wrapping |
| Overview | Hero, navigation and workflow preview |
| Legacy workspace | Scope, effort, delivery and empty views |
| Legacy history | Metrics, CSV import controls, reference table and learning empty state |
| Dialogs | New request and help; scrollable phone layout |

## Separate Next.js application (`apps/web`)

This companion app is served locally at `localhost:3000`; it is separate from
the hosted Sites application above. The landing page reuses the interactive,
ElevenLabs-inspired workflow presentation. Its regular entry opens an empty
AI-only estimate form; the fictional example preloads illustrative text and
still uses AI analysis. Its shared styles give inputs and buttons clear
boundaries, 44px minimum control height, visible keyboard focus, and reduced-
motion handling.

| Route or state | Coverage and local result |
| --- | --- |
| Landing page | Hero, workflow tabs, synthetic-data illustration, workflow cards and both calls to action |
| `/estimate` | Empty request intake, supported-file affordance, AI-only analysis notice, review placeholder and saved-estimate state |
| `/estimate?sample=1` | Fictional brief preloaded; AI-only analysis remains selected |
| `/sign-in` | Sign-in and registration forms; identity setup notice when the local identity service is unavailable |
| `/password-recovery` and `/verify-email` | Recovery and verification forms with visible input borders and focus styles |
| `/account` and `/workspace` | Authentication gates redirect to the landing page or sign-in because local identity is not configured; authenticated views cannot be inspected here |

At 390px, landing, estimate, sign-in, recovery and verification routes had no
document-width overflow. `/account` and `/workspace` resolved to their expected
authentication redirects. At 1280px, the restored landing page rendered its
two-column hero and interactive workflow preview. This check did not submit an
AI request or create an account. The companion app is not part of the current
Sites deployment.

Review desktop and phone layouts with browser screenshots and check document
scroll width against viewport width. Check intermediate widths for the request
editor and template fields. These checks supplement the type check, production
build, 27 estimator/evaluation/product-selection tests and compiled Worker workflow QA.

AI product selections are restricted to the configured catalog. Unknown or
retired IDs display and submit the same empty selection in editable drafts;
immutable frozen snapshots retain their original value.

Independent reviewer approval, tenant boundaries, credential revocation and
signed webhook behavior are exercised with separate fictional actors in the
isolated compiled Worker check. A second real signed-in reviewer and a real
form-provider sender remain external setup steps. Never grant extra production
access just to produce a screenshot.
