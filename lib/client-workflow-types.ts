import { evaluateReviewDecisions } from "./review-policy.ts";
import { reviewBlockerMessages } from "./review-policy-messages.ts";
import type { RequestInboxPage } from "./workflow-query-types";

export const requestTypes = ["demo", "setup", "migration", "integration", "customization", "support"] as const;
export type RequestType = typeof requestTypes[number];
export type RequestStatus = "received" | "analyzing" | "needs_review" | "scope_confirmed" | "estimated" | "frozen" | "analysis_failed";
export type TaskTemplate = { id: string; label: string; baseHours: number; lowFactor: number; highFactor: number };
export type Product = { id: string; name: string; description: string };
export type IntakeField = { key: string; label: string; requestTypes: RequestType[]; required: boolean; priority?: number };
export type CompanyRole = "admin" | "estimator" | "reviewer" | "viewer";
export type CompanyMember = { userId: string; displayName: string; role: CompanyRole; owner?: boolean };
export type EvaluationDeclaration = { protocol: "the-estimator-delivery-holdout-v1"; cohort: "synthetic" | "recorded"; domain: string; split: "training" | "holdout"; declaredAt: string };
export type DeliveryOutcome = { id: string; baselineId: string; baselineSha256: string; actualHours: Record<string, number>; originalHours: number; addedScopeHours: number; evidence: string; submittedBy: string; submittedName: string; submittedAt: string; deliveredAt: string; reviewerId: string; status: "pending" | "approved" | "rejected"; reviewedBy?: string; reviewedName?: string; reviewedAt?: string; reviewNotes?: string };
export type WorkflowAudit = { id: string; actor: string; action: string; requestId: string; createdAt: string };
export type EvaluationMetrics = { n: number; baseMAEHours: number | null; adjustedMAEHours: number | null; signedBiasHours: number | null; adjustedSignedBiasHours?: number | null; rangeCoverage: number | null; adjustedRangeCoverage?: number | null; domains: Record<string, number> };
export type DeliveryEvaluation = { protocol: string; methodology: string; counts: { frozen: number; pending: number; rejected: number; excluded: number; training: number }; recorded: EvaluationMetrics; synthetic: EvaluationMetrics; warnings: string[] };
export type KnowledgeSource = { id: string; title: string; url: string; text: string; status: "draft" | "approved" | "retired"; sha256: string; addedAt: string; approvedAt?: string; approvedBy?: string; retrievedAt?: string; contentType?: string; truncated?: boolean };
export type CompanyConfig = {
  version: number;
  fields: IntakeField[];
  products: Product[];
  capabilities: string[];
  tasks: TaskTemplate[];
};
export type ScopeFact = { key: string; value: string; source: string; evidence: string; status: "source" | "inference" };
export type ScopeWorkPackage = {
  id: string;
  taskId: string;
  title: string;
  quantity: number;
  complexity: "low" | "medium" | "high";
  owner: "company" | "customer" | "vendor";
  acceptance: string;
  dependencies: string;
  rationale?: string;
  evidence?: string;
  evidenceSource?: string;
};
export type TaskTrackingStatus = "not_started" | "in_progress" | "blocked" | "complete";
export type TaskMilestone = { id: string; title: string; dueDate: string; status: "pending" | "complete" };
export type RequestTaskTracking = { workPackageId: string; status: TaskTrackingStatus; assignee: string; plannedStart: string; plannedEnd: string; blocker: string; milestones: TaskMilestone[] };
export type ScopeChange = { id: string; description: string; reason: string; effortImpact: string; createdBy: string; createdAt: string; status: "proposed" };
export type ClientAnalysis = {
  summary: string;
  requestType: RequestType;
  productId: string;
  facts: ScopeFact[];
  capabilityFindings: { capability: string; status: "supported" | "gap" | "unknown"; evidence: string; explanation: string }[];
  productFindings: { productId: string; status: "fit" | "gap" | "unknown"; explanation: string; sourceId: string; evidence: string }[];
  assumptions: string[];
  conflicts: string[];
  questions: string[];
  deliverables: string;
  exclusions: string;
  acceptance: string;
  dependencies: string;
  workPackages: ScopeWorkPackage[];
  sourceCheck: string;
  run: { model: string; elapsedMs: number; steps: string[] };
};
export type RequestAttachment = { id: string; name: string; type: string; size: number; sha256: string; text: string; status: "extracted" | "needs_attention" | "ocr_required"; message?: string; locators: string[]; truncated: boolean; objectKey?: string };
export type ScopeReview = {
  requestType: RequestType;
  productId: string;
  deliverables: string;
  exclusions: string;
  acceptance: string;
  dependencies: string;
  questions: string[];
  questionResolutions?: Record<string, { disposition?: "answered" | "not_applicable"; resolution: string; question?: string }>;
  findingReviews?: Record<string, { disposition: "accepted" | "corrected" | "rejected"; correction: string }>;
  workPackages: ScopeWorkPackage[];
  confirmed: boolean;
  confirmedBy: string;
  confirmedAt?: string;
  domain?: string;
  fieldAnswers?: Record<string, string>;
  sourceLimitationsAcknowledged?: boolean;
  confirmedConfigVersion?: number;
  confirmedCompanyVersion?: number;
};
export type EstimateTask = { templateId: string; label: string; quantity: number; baseHours: number; lowHours: number; highHours: number; adjustedHours?: number; adjustedLowHours?: number; adjustedHighHours?: number; calibrationFactor?: number; calibrationSamples?: number; calibrationBaselines?: string[]; complexity: string; assumptions: string[] };
export type EstimateCalibrationSummary = { method: "approved-recorded-training-median-v1"; domain: string; requestType: RequestType; minimumSamplesPerTask: number; maximumAdjustmentFactor: number; appliedTasks: number; taskSamples: Record<string, number>; sourceBaselineIds: string[]; excluded: { holdout: number; synthetic: number; unreviewedOrInvalid: number; notComparable: number } };
export type WorkflowEstimate = { tasks: EstimateTask[]; baseHours: number; lowHours: number; highHours: number; adjustedHours?: number; adjustedLowHours?: number; adjustedHighHours?: number; configVersion: number; engineVersion: string; calibration: "uncalibrated" | "training-history"; calibrationSummary?: EstimateCalibrationSummary };
export type FrozenBaseline = { id: string; revision: number; createdAt: string; sha256: string; configVersion: number; review: ScopeReview; estimate: WorkflowEstimate; evaluation?: EvaluationDeclaration; configuration?: CompanyConfig; knowledge?: KnowledgeSource[] };
export type ClientRequest = {
  id: string;
  title: string;
  text: string;
  attachments: RequestAttachment[];
  channel: "manual" | "webhook";
  cohort?: "synthetic" | "recorded";
  createdBy?: string;
  delivery?: DeliveryOutcome[];
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  version: number;
  analysis?: ClientAnalysis;
  analysisError?: string;
  review: ScopeReview;
  estimate?: WorkflowEstimate;
  baselines: FrozenBaseline[];
  taskTracking?: RequestTaskTracking[];
  scopeChanges?: ScopeChange[];
};
export type Company = {
  id: string;
  name: string;
  version: number;
  role: CompanyRole;
  ownerId: string;
  members: CompanyMember[];
  connectors: { webhookConfigured: boolean; mcpConfigured: boolean; encryptionReady: boolean; lastInboundAt?: string; lastInboundStatus?: string };
  audit: WorkflowAudit[];
  evaluation: DeliveryEvaluation;
  insights?: import("./workflow-activity").CompanyActivityInsights;
  config: CompanyConfig;
  knowledge: KnowledgeSource[];
  requests: ClientRequest[];
};
export type CompanySummary = { id: string; name: string; version: number; role: CompanyRole; requestCount: number };
export type WorkspaceResponse = { inbox?: RequestInboxPage; companies: CompanySummary[]; company?: Company; selectedId?: string; aiReady: boolean; actorId: string; issuedCredential?: { kind: "webhook" | "mcp"; value: string } };

/** Compatibility helper for callers that validate only review decisions. */
export function scopeReviewBlockers(review: ScopeReview, analysis: ClientAnalysis): string[] {
  return reviewBlockerMessages(evaluateReviewDecisions(review, analysis).blockers);
}

const TRAINING_MINIMUM_SAMPLES = 3;
const TRAINING_MAX_ADJUSTMENT_FACTOR = 2;

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function normalizeDomain(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function calibrationGroup(taskId: string, complexity: string): string {
  return `${taskId}\u001f${complexity}`;
}

export function isIndependentlyReviewedOriginalScopeOutcome(baseline: FrozenBaseline, outcome: DeliveryOutcome): boolean {
  const reviewedAt = Date.parse(outcome.reviewedAt ?? "");
  const submittedAt = Date.parse(outcome.submittedAt);
  const deliveredAt = Date.parse(outcome.deliveredAt);
  const frozenAt = Date.parse(baseline.createdAt);
  const declaredAt = Date.parse(baseline.evaluation?.declaredAt ?? "");
  const packages = baseline.review.workPackages ?? [];
  const actualHours = outcome.actualHours;
  if (outcome.status !== "approved" || outcome.baselineId !== baseline.id || outcome.baselineSha256 !== baseline.sha256 || !Number.isFinite(reviewedAt) || !Number.isFinite(submittedAt) || !Number.isFinite(deliveredAt) || !Number.isFinite(frozenAt) || !Number.isFinite(declaredAt) || reviewedAt < submittedAt || reviewedAt < deliveredAt || deliveredAt < frozenAt || declaredAt > submittedAt || !outcome.reviewedBy || outcome.reviewedBy !== outcome.reviewerId || outcome.reviewedBy === outcome.submittedBy || typeof outcome.evidence !== "string" || outcome.evidence.trim().length < 20 || typeof outcome.reviewNotes !== "string" || outcome.reviewNotes.trim().length < 20 || !packages.length || !actualHours || typeof actualHours !== "object" || Array.isArray(actualHours)) return false;
  const expectedIds = packages.map(item => item.id);
  const actualIds = Object.keys(actualHours);
  const actualValues = Object.values(actualHours);
  const actualTotal = actualValues.reduce((sum, value) => sum + value, 0);
  return actualIds.length === expectedIds.length && expectedIds.every(id => Object.hasOwn(actualHours, id)) && actualValues.every(finiteNonNegative) && finiteNonNegative(outcome.originalHours) && Math.abs(actualTotal - outcome.originalHours) <= 0.11 && actualTotal > 0 && finiteNonNegative(outcome.addedScopeHours);
}

/**
 * Adjust configured task priors from comparable, independently approved,
 * recorded training projects. Synthetic and holdout records are excluded here
 * regardless of any request-level cohort field.
 */
export function applyApprovedTrainingHistory(
  tasks: EstimateTask[],
  review: ScopeReview,
  history: readonly ClientRequest[],
): Pick<WorkflowEstimate, "tasks" | "adjustedHours" | "adjustedLowHours" | "adjustedHighHours" | "calibration" | "calibrationSummary"> {
  const ratiosByTask = new Map<string, Array<{ ratio: number; baselineId: string }>>();
  const excluded = { holdout: 0, synthetic: 0, unreviewedOrInvalid: 0, notComparable: 0 };
  const seenRequests = new Set<string>();
  const matchingHistory = history.filter(request => {
    if (!request.id || seenRequests.has(request.id)) return false;
    seenRequests.add(request.id);
    return true;
  });

  for (const request of matchingHistory) {
    const candidates = (request.delivery ?? []).flatMap(outcome => {
      const baseline = request.baselines.find(item => item.id === outcome.baselineId);
      if (!baseline || !baseline.evaluation || baseline.evaluation.protocol !== "the-estimator-delivery-holdout-v1") {
        excluded.unreviewedOrInvalid++;
        return [];
      }
      if (baseline.evaluation.cohort === "synthetic" || request.cohort === "synthetic") {
        excluded.synthetic++;
        return [];
      }
      if (baseline.evaluation.split === "holdout") {
        excluded.holdout++;
        return [];
      }
      if (baseline.evaluation.cohort !== "recorded" || baseline.evaluation.split !== "training" || !isIndependentlyReviewedOriginalScopeOutcome(baseline, outcome) || normalizeDomain(baseline.evaluation.domain) !== normalizeDomain(baseline.review.domain)) {
        excluded.unreviewedOrInvalid++;
        return [];
      }
      if (normalizeDomain(baseline.review.domain) !== normalizeDomain(review.domain) || baseline.review.requestType !== review.requestType) {
        excluded.notComparable++;
        return [];
      }
      const packages = baseline.review.workPackages;
      const estimates = baseline.estimate.tasks;
      if (!packages.length || estimates.length !== packages.length) {
        excluded.unreviewedOrInvalid++;
        return [];
      }
      const byTask = new Map<string, { estimated: number; actual: number }>();
      for (let index = 0; index < packages.length; index++) {
        const workPackage = packages[index]!;
        const estimate = estimates[index]!;
        const actual = outcome.actualHours[workPackage.id];
        if (estimate.templateId !== workPackage.taskId || !finiteNonNegative(estimate.baseHours) || estimate.baseHours <= 0 || !finiteNonNegative(actual)) {
          excluded.unreviewedOrInvalid++;
          return [];
        }
        const group = calibrationGroup(workPackage.taskId, workPackage.complexity);
        const current = byTask.get(group) ?? { estimated: 0, actual: 0 };
        current.estimated += estimate.baseHours;
        current.actual += actual;
        byTask.set(group, current);
      }
      return [{ deliveredAt: outcome.deliveredAt, baselineId: baseline.id, byTask }];
    });

    // One project can contribute at most once, even if it has several frozen revisions.
    const selected = candidates.sort((left, right) => right.deliveredAt.localeCompare(left.deliveredAt))[0];
    if (!selected) continue;
    for (const [taskId, totals] of selected.byTask) {
      const samples = ratiosByTask.get(taskId) ?? [];
      samples.push({ ratio: totals.actual / totals.estimated, baselineId: selected.baselineId });
      ratiosByTask.set(taskId, samples);
    }
  }

  const taskSamples: Record<string, number> = {};
  const sourceBaselineIds = new Set<string>();
  let appliedTasks = 0;
  const adjustedTasks = tasks.map(task => {
    const group = calibrationGroup(task.templateId, task.complexity);
    const samples = ratiosByTask.get(group) ?? [];
    taskSamples[group] = samples.length;
    if (samples.length < TRAINING_MINIMUM_SAMPLES) {
      return { ...task, adjustedHours: task.baseHours, adjustedLowHours: task.lowHours, adjustedHighHours: task.highHours, calibrationFactor: 1, calibrationSamples: samples.length, calibrationBaselines: [] };
    }
    const factor = Math.min(TRAINING_MAX_ADJUSTMENT_FACTOR, Math.max(1 / TRAINING_MAX_ADJUSTMENT_FACTOR, median(samples.map(item => item.ratio))));
    const used = samples.map(item => item.baselineId);
    used.forEach(id => sourceBaselineIds.add(id));
    appliedTasks++;
    return {
      ...task,
      adjustedHours: Number((task.baseHours * factor).toFixed(1)),
      adjustedLowHours: Number((task.lowHours * factor).toFixed(1)),
      adjustedHighHours: Number((task.highHours * factor).toFixed(1)),
      calibrationFactor: Number(factor.toFixed(3)),
      calibrationSamples: samples.length,
      calibrationBaselines: [...new Set(used)],
      assumptions: [...task.assumptions, `Adjusted by a ${factor.toFixed(2)}× median of ${samples.length} independently approved recorded training projects matching ${review.domain}, ${review.requestType}, ${task.templateId}, and ${task.complexity} complexity; holdout and synthetic outcomes are excluded.`],
    };
  });
  const sum = (key: "adjustedHours" | "adjustedLowHours" | "adjustedHighHours") => Number(adjustedTasks.reduce((total, task) => total + (task[key] ?? 0), 0).toFixed(1));
  const calibration = appliedTasks > 0 ? "training-history" as const : "uncalibrated" as const;
  return {
    tasks: adjustedTasks,
    adjustedHours: sum("adjustedHours"),
    adjustedLowHours: sum("adjustedLowHours"),
    adjustedHighHours: sum("adjustedHighHours"),
    calibration,
    calibrationSummary: {
      method: "approved-recorded-training-median-v1" as const,
      domain: review.domain ?? "",
      requestType: review.requestType,
      minimumSamplesPerTask: TRAINING_MINIMUM_SAMPLES,
      maximumAdjustmentFactor: TRAINING_MAX_ADJUSTMENT_FACTOR,
      appliedTasks,
      taskSamples,
      sourceBaselineIds: [...sourceBaselineIds].sort(),
      excluded,
    },
  };
}
