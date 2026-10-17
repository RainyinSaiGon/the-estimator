# UI direction — 17 October 2026

Reference: [ElevenLabs landing page](https://elevenlabs.io/), inspected live on 17 October 2026.

The Estimator adapts its generous white space, black sans-serif headings, pill actions, restrained navigation, and rounded tabbed product canvas. Product content, the stacked-layer brand, and the illustrations are specific to The Estimator.

## Overview

- Split hero introduces the scoping workflow and offers a new request or a prefilled sample.
- Scope, Estimate, and Learn tabs show illustrative product scenes. Their example hours and project details are synthetic.
- Preview tabs support arrow keys, Home, and End, with labelled tab panels.
- Workflow cards explain source evidence, reviewed estimates, and original-scope delivery records.
- The overview remains accessible after requests exist, through the shared navigation.

## Workspace

The shared visual system covers requests, history, effort summaries, forms, tables, and dialogs. A dedicated empty state invites the first request. Actual estimation, persistence, review, baseline, export, and calibration behavior continue to use the existing implementation.

## Responsive behavior

At narrow widths, navigation wraps, the hero and product canvas stack, and workflow cards become a single column. The request sidebar becomes compact navigation. Dialogs stay centered with scrolling content. Reduced-motion preferences disable animation and smooth scrolling.

No external image or font service is required. Product scenes are rendered with HTML, CSS, and the existing Lucide icons.
