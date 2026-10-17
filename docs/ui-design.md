# UI direction — 17 October 2026

Live references checked on 17 October 2026: [ElevenLabs home](https://elevenlabs.io/), [ElevenCreative](https://elevenlabs.io/creative), and [Studio](https://elevenlabs.io/studio). These public pages share bright neutral surfaces, confident sans-serif headings, compact navigation, and rounded black primary actions. The unauthenticated `/app/home` route rendered blank in the review browser, so the logged-in ElevenLabs workspace was not available for comparison.

The Estimator adapts the public reference's generous white space, confident sans-serif headings, restrained navigation, and rounded controls. Its green signal accent makes effort and status easy to scan while keeping product content, the stacked-layer brand, and interface specific to The Estimator. The reference is a visual cue, not a claim of partnership or copied assets.

## Workspace system

Tailwind CSS 4 owns the shared color and font tokens in `app/globals.css` through `@theme`. Component rules use Tailwind layers and `@apply` so utility classes can compose and override the workspace styles.

| Token | Value | Use |
| --- | --- | --- |
| `estimator-ink` | `#171915` | Primary text and dark surfaces |
| `estimator-muted` | `#686b62` | Secondary text |
| `estimator-line` | `#e3e5dc` | Dividers and card borders |
| `estimator-canvas` | `#f7f7f3` | Workspace canvas |
| `estimator-paper` | `#fbfaf6` | Source brief surface |
| `estimator-signal` | `#d9ff68` | Primary actions, brand mark, and effort emphasis |
| `estimator-accent` | `#6457ee` | Keyboard focus and saved-state cue |

The reading order is request identity and status, source brief, requested work, unresolved scope questions, effort summary, and its next action. The effort summary uses the signal color on a dark surface; source evidence stays on a quiet paper surface. Status also uses a text label and is never communicated by color alone. Stage buttons expose their pressed/current state to assistive technology. Keyboard focus uses the accent outline. Existing reduced-motion rules disable animation and smooth scrolling.

At narrow widths the workspace collapses to one column, request stages stay in a single row, and estimate details follow the scope content. Tables retain their own horizontal scroll containers so they cannot widen the page.

## Overview

- Split hero introduces the scoping workflow and offers a new request or a prefilled sample.
- Scope, Estimate, and Learn tabs show illustrative product scenes. Their example hours and project details are synthetic.
- Preview tabs support arrow keys, Home, and End, with labelled tab panels.
- Workflow cards explain source evidence, reviewed estimates, and original-scope delivery records.
- The overview remains accessible after requests exist, through the shared navigation.

## Workspace

The shared visual system covers requests, history, effort summaries, forms, tables, and dialogs. A dedicated empty state invites the first request. Actual estimation, persistence, review, baseline, export, and calibration behavior continue to use the existing implementation. The updated authenticated request workspace is available in the existing local preview; production traffic and deployment remain unchanged.

## Responsive behavior

At narrow widths, navigation wraps, the hero and product canvas stack, and workflow cards become a single column. The request sidebar becomes compact navigation. Dialogs stay centered with scrolling content. Reduced-motion preferences disable animation and smooth scrolling.

No external image or font service is required. Product scenes are rendered with HTML, CSS, and the existing Lucide icons.
