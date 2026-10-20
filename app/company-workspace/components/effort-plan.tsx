"use client";

import type { ClientRequest } from "../../../lib/client-workflow-types";
import { Metric } from "../ui";

export function EstimateTable({ estimate, taskSizeGuidelineHours = 16 }: { estimate: NonNullable<ClientRequest["estimate"]>; taskSizeGuidelineHours?: number }) {
  const summary = estimate.calibrationSummary;
  const priorLow = estimate.lowHours;
  const priorHigh = estimate.highHours;
  const priorCentral = estimate.baseHours;
  const forecastLow = estimate.adjustedLowHours ?? priorLow;
  const forecastHigh = estimate.adjustedHighHours ?? priorHigh;
  const forecastCentral = estimate.adjustedHours ?? priorCentral;
  const minimumSamples = summary?.minimumSamplesPerTask;
  const exclusions = summary?.excluded;
  const excludedCounts = exclusions
    ? ([
        ["Holdout", exclusions.holdout],
        ["Synthetic", exclusions.synthetic],
        ["Unreviewed or invalid", exclusions.unreviewedOrInvalid],
        ["Not comparable", exclusions.notComparable],
      ] as const)
    : [];
  const adjustedTaskCount = estimate.tasks.filter(
    (task) => task.calibrationFactor !== undefined && task.calibrationFactor !== 1,
  ).length;
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Configured prior · range" value={`${priorLow}–${priorHigh} h`} />
        <Metric label="Configured prior · central" value={`${priorCentral} h`} />
        <Metric label="Adjusted forecast · range" value={`${forecastLow}–${forecastHigh} h`} />
        <Metric label="Adjusted forecast · central" value={`${forecastCentral} h`} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full min-w-[860px] whitespace-normal text-left text-sm">
          <thead className="bg-[var(--paper)] text-xs text-[var(--muted)]">
            <tr>
              <th className="p-3">Work package</th>
              <th className="p-3">Quantity</th>
              <th className="p-3">Configured prior</th>
              <th className="p-3">Adjusted forecast</th>
              <th className="p-3">Approved training</th>
            </tr>
          </thead>
          <tbody>
            {estimate.tasks.map((task, index) => {
              const samples = summary?.taskSamples[task.templateId];
              return (
                <tr className="border-t border-[var(--line)]" key={`${task.templateId}-${index}`}>
                  <td className="min-w-60 p-3">
                    <strong>{task.label}</strong>
                    {(task.adjustedHours ?? task.baseHours) > taskSizeGuidelineHours && <p className="mt-1 text-xs text-amber-900">Above your {taskSizeGuidelineHours} h sizing guideline. Consider splitting this task before commitment.</p>}
                    <ul className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {task.assumptions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-3">
                    {task.quantity} · {task.complexity}
                  </td>
                  <td className="p-3">
                    {task.lowHours}–{task.highHours} h<br />
                    <span className="text-xs text-[var(--muted)]">central {task.baseHours} h</span>
                  </td>
                  <td className="p-3">
                    {task.adjustedLowHours ?? task.lowHours}–
                    {task.adjustedHighHours ?? task.highHours} h<br />
                    <span className="text-xs text-[var(--muted)]">
                      central {task.adjustedHours ?? task.baseHours} h · ×
                      {(task.calibrationFactor ?? 1).toFixed(2)}
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    {samples === undefined
                      ? "Sample count unavailable"
                      : `${samples}${minimumSamples ? ` / ${minimumSamples}` : ""} examples`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--line)] p-4 text-xs leading-5 text-[var(--muted)]">
        <p className="font-semibold text-[var(--ink)]">
          {estimate.calibration === "training-history"
            ? `Training-history adjustment · ${summary?.appliedTasks ?? adjustedTaskCount} task${(summary?.appliedTasks ?? adjustedTaskCount) === 1 ? "" : "s"} adjusted`
            : "Configured priors unchanged"}
        </p>
        {summary ? (
          <>
            <p className="mt-1">
              Method: {summary.method} · domain: {summary.domain || "unspecified"} · request type:{" "}
              {summary.requestType}. Minimum {summary.minimumSamplesPerTask} independently approved
              training examples per task; adjustment capped at ×{summary.maximumAdjustmentFactor}.
            </p>
            {estimate.calibration === "uncalibrated" && (
              <p className="mt-1">
                No task met the minimum sample threshold. The adjusted forecast is identical to the
                configured prior.
              </p>
            )}
            <p className="mt-1">
              Excluded outcomes —{" "}
              {excludedCounts.map(([name, count]) => `${name}: ${count}`).join(" · ")}.
            </p>
            {summary.sourceBaselineIds.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer font-medium text-[var(--ink)]">
                  Contributing approved baseline records ({summary.sourceBaselineIds.length})
                </summary>
                <ul className="mt-1 space-y-1 font-mono">
                  {summary.sourceBaselineIds.map((id) => (
                    <li key={id} className="break-all">
                      {id}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="mt-1">
            This saved estimate has no training-history provenance metadata. Its configured prior
            values remain visible above.
          </p>
        )}
        <p className="mt-2">
          Calendar delivery dates also depend on staffing availability, client response time and
          vendor prerequisites. Those values are not estimated here.
        </p>
      </div>
    </>
  );
}
