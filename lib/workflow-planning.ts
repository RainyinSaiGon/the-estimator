import {
  applyApprovedTrainingHistory,
  scopeReviewBlockers,
  type ClientRequest,
  type Company,
  type ScopeReview,
  type ScopeWorkPackage,
  type WorkflowEstimate,
} from "./client-workflow-types";
import { ClientWorkflowError } from "./workflow-errors";

export function makeEstimate(
  review: ScopeReview,
  company: Company,
  history: readonly ClientRequest[],
): WorkflowEstimate {
  const templates = new Map(company.config.tasks.map((task) => [task.id, task]));
  const factor: Record<ScopeWorkPackage["complexity"], number> = {
    low: 0.75,
    medium: 1,
    high: 1.6,
  };
  const tasks = review.workPackages.map((item) => {
    const template = templates.get(item.taskId);
    if (!template)
      throw new ClientWorkflowError(
        `The task template for ${item.title} no longer exists. Review the scope again.`,
      );
    const baseHours = Number(
      (template.baseHours * item.quantity * factor[item.complexity]).toFixed(1),
    );
    return {
      templateId: template.id,
      label: item.title || template.label,
      quantity: item.quantity,
      baseHours,
      lowHours: Number((baseHours * template.lowFactor).toFixed(1)),
      highHours: Number((baseHours * template.highFactor).toFixed(1)),
      complexity: item.complexity,
      assumptions: [
        `${template.baseHours} h per unit before the ${item.complexity} complexity factor`,
        `Planning range uses configured factors ${template.lowFactor}–${template.highFactor} before any eligible training-history adjustment; holdout outcomes are never used.`,
      ],
    };
  });
  const learned = applyApprovedTrainingHistory(tasks, review, history);
  return {
    tasks: learned.tasks,
    baseHours: Number(tasks.reduce((sum, item) => sum + item.baseHours, 0).toFixed(1)),
    lowHours: Number(tasks.reduce((sum, item) => sum + item.lowHours, 0).toFixed(1)),
    highHours: Number(tasks.reduce((sum, item) => sum + item.highHours, 0).toFixed(1)),
    adjustedHours: learned.adjustedHours,
    adjustedLowHours: learned.adjustedLowHours,
    adjustedHighHours: learned.adjustedHighHours,
    configVersion: company.config.version,
    engineVersion: "sites-planning/1.1",
    calibration: learned.calibration,
    calibrationSummary: learned.calibrationSummary,
  };
}

export function scopeReadinessBlockers(request: ClientRequest, company: Company): string[] {
  if (!request.analysis) return ["Analyze the request before confirming or estimating its scope."];
  const blockers = scopeReviewBlockers(request.review, request.analysis);
  if (!request.review.deliverables.trim())
    blockers.push("Add at least one deliverable before confirming the scope.");
  if (!request.review.domain?.trim())
    blockers.push("Add a reviewed work domain before confirming the scope.");
  const missing = company.config.fields.filter(
    (field) =>
      field.required &&
      field.requestTypes.includes(request.review.requestType) &&
      !request.review.fieldAnswers?.[field.key]?.trim(),
  );
  if (missing.length)
    blockers.push(`Complete required fields: ${missing.map((field) => field.label).join(", ")}.`);
  if (
    request.attachments.some((file) => file.status !== "extracted" || file.truncated) &&
    !request.review.sourceLimitationsAcknowledged
  )
    blockers.push(
      "Reconcile incomplete sources and acknowledge their limitations before confirming scope.",
    );
  return blockers;
}
