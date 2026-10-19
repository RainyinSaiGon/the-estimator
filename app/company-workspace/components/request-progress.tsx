"use client";

import type { ClientRequest } from "../../../lib/client-workflow-types";

export function Progress({
  request,
  needsReview,
}: {
  request: ClientRequest;
  needsReview: boolean;
}) {
  const steps = ["Brief & AI analysis", "Review scope", "Calculate effort", "Commit & track"];
  const current =
    request.status === "frozen"
      ? 4
      : !request.analysis || request.status === "analyzing" || request.status === "analysis_failed"
        ? 1
        : needsReview || !request.review.confirmed
          ? 2
          : request.estimate
            ? 4
            : 3;
  return (
    <div
      aria-label="Request progress"
      className="rounded-xl border border-estimator-line bg-estimator-canvas/70 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-estimator-muted">
          Workflow progress
        </p>
        <p className="text-xs font-medium text-estimator-ink">
          Step {current} of {steps.length} · {steps[current - 1]}
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index + 1 === current ? "step" : undefined}
            className="min-w-0"
          >
            <div
              className={`mb-2 h-1.5 rounded-full ${index + 1 < current ? "bg-estimator-ink" : index + 1 === current ? "bg-estimator-accent" : "bg-estimator-line"}`}
            />
            <span
              className={`text-[10px] leading-4 sm:text-xs ${index + 1 <= current ? "font-medium text-estimator-ink" : "text-estimator-muted"}`}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
