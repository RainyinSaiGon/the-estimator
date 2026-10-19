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
- At phone widths, stack the company selector and use a compact two-row section
  navigation. Keep long IDs, hashes, source passages and task names inside their
  cards. Wide estimate tables scroll inside their own container.

## Verification coverage

Browser review uses fictional local data and explicitly synthetic hosted test
requests. It does not establish recorded delivery performance.

| Surface | Coverage |
| --- | --- |
| Company sign-in, loading, empty and create states | Centering, typography, primary action and form layout |
| Company Requests | Empty list, intake form, multi-file extraction, analyzed evidence, editable scope, effort plan and frozen baseline |
| Knowledge | Source form, draft/approved library and provenance wrapping |
| Settings | Versioned configuration fields and save controls |
| Members | Account ID, role descriptions and member form |
| Connectors | Webhook setup/status and root `/mcp` discovery instructions |
| Evaluation | Warnings, separate recorded/synthetic cards and export controls |
| Audit | Event layout and long identity wrapping |
| Overview | Hero, navigation and workflow preview |
| Legacy workspace | Scope, effort, delivery and empty views |
| Legacy history | Metrics, CSV import controls, reference table and learning empty state |
| Dialogs | New request and help; scrollable phone layout |

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
