# Estimation method

The language model extracts requirements and confirmed facts; it does not calculate effort. The estimator starts from explicit task-level base hours and adjusts them for direction, API readiness, mapping, data quality, and volume.

For integration estimates, historical tasks are matched using weighted feature similarity with a minimum score of `0.45`. Each task uses the median of comparable actual-to-base effort ratios, shrunk toward `1` with prior strength of four observations. Ratios are bounded between `0.35` and `3`.

Unknowns, sparse history, and observed spread widen the planning range. This is a **heuristic planning range**, not a statistical confidence interval. General-work estimates are marked uncalibrated. A project is excluded from its own estimate; only original-scope actuals can inform future comparisons, while added-scope hours stay separate.

The app stores frozen baseline values so later comparisons use the prediction that was actually made. Reports describe the supplied cohort; synthetic examples stay separate from recorded deliveries. Neither the existence of a feedback loop nor a small evaluation sample proves that estimates have improved.
