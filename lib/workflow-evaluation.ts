import { isIndependentlyReviewedOriginalScopeOutcome, type ClientRequest, type DeliveryEvaluation, type EvaluationDeclaration, type EvaluationMetrics } from "./client-workflow-types.ts";

/** Minimal immutable record needed by delivery evaluation and reproducible exports. */
export type DeliveryRecord = Pick<ClientRequest, "id" | "channel" | "cohort" | "createdAt" | "createdBy" | "baselines" | "delivery">;

export async function declareDeliverySplit(companyId: string, requestId: string, cohort: "synthetic" | "recorded", domain: string, at: string): Promise<EvaluationDeclaration> {
  void companyId;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`the-estimator-delivery-holdout-v1:${requestId}`));
  const bucket = new Uint8Array(bytes)[0] % 5;
  return { protocol: "the-estimator-delivery-holdout-v1", cohort, domain, split: bucket === 0 ? "holdout" : "training", declaredAt: at };
}

export function createDeliveryEvaluationAccumulator() {
  const empty = () => ({ n: 0, baseError: 0, adjustedError: 0, bias: 0, adjustedBias: 0, covered: 0, adjustedCovered: 0, domains: {} as Record<string, number> });
  const samples = { recorded: empty(), synthetic: empty() };
  const counts = { frozen: 0, pending: 0, rejected: 0, excluded: 0, training: 0 };
  function add(request: DeliveryRecord) {
    if (request.baselines.length) counts.frozen++;
    for (const outcome of request.delivery ?? []) {
      if (outcome.status === "pending") { counts.pending++; continue; }
      if (outcome.status === "rejected") { counts.rejected++; continue; }
      const base = request.baselines.find(item => item.id === outcome.baselineId && item.sha256 === outcome.baselineSha256);
      const declaration = base?.evaluation;
      if (!base || !declaration || !isIndependentlyReviewedOriginalScopeOutcome(base, outcome)) { counts.excluded++; continue; }
      if (declaration.split === "training") { counts.training++; continue; }
      const row = samples[declaration.cohort];
      const prediction = base.estimate;
      const adjusted = prediction.adjustedHours ?? prediction.baseHours;
      row.n++;
      row.baseError += Math.abs(prediction.baseHours - outcome.originalHours);
      row.adjustedError += Math.abs(adjusted - outcome.originalHours);
      row.bias += prediction.baseHours - outcome.originalHours;
      row.adjustedBias += adjusted - outcome.originalHours;
      row.covered += Number(outcome.originalHours >= prediction.lowHours && outcome.originalHours <= prediction.highHours);
      row.adjustedCovered += Number(outcome.originalHours >= (prediction.adjustedLowHours ?? prediction.lowHours) && outcome.originalHours <= (prediction.adjustedHighHours ?? prediction.highHours));
      row.domains[declaration.domain] = (row.domains[declaration.domain] ?? 0) + 1;
    }
  }
  function metrics(cohort: "recorded" | "synthetic"): EvaluationMetrics {
    const row = samples[cohort];
    const mean = (sum: number) => row.n ? Number((sum / row.n).toFixed(4)) : null;
    return { n: row.n, baseMAEHours: mean(row.baseError), adjustedMAEHours: mean(row.adjustedError), signedBiasHours: mean(row.bias), adjustedSignedBiasHours: mean(row.adjustedBias), rangeCoverage: mean(row.covered), adjustedRangeCoverage: mean(row.adjustedCovered), domains: { ...row.domains } };
  }

  function result(): DeliveryEvaluation {
  const recorded = metrics("recorded");
  return { protocol: "the-estimator-delivery-holdout-v1", methodology: "SHA-256(the-estimator-delivery-holdout-v1:<record-id>)[0] modulo 5; bucket 0 is holdout (20%). Declaration is frozen before delivery. Only independently approved original-scope task actuals count. Added scope is excluded. Training-history adjustments use only independently approved recorded training outcomes from matching request type and domain; synthetic and holdout outcomes are excluded. Base and adjusted predictions are reported separately.", counts, recorded, synthetic: metrics("synthetic"), warnings: [recorded.n === 0 ? "No eligible recorded holdout outcomes are available." : recorded.n < 30 ? "The recorded holdout is small; descriptive results cannot establish accuracy or improvement." : "Sample size alone does not establish representativeness or improvement.", "Work domains, customer mix, selection bias and evidence quality require human review. Synthetic results are separate and cannot support recorded-performance claims.", "Legacy baselines without a predeclared split are excluded. Issues #38 and #39 still require real representative approved evidence."] };
  }
  return { add, result };
}

export function evaluateDeliveries(requests: ClientRequest[]): DeliveryEvaluation {
  const accumulator = createDeliveryEvaluationAccumulator();
  for (const request of requests) accumulator.add(request);
  return accumulator.result();
}

export function exportDeliveryRecords(requests: DeliveryRecord[]) {
  return requests.map(request => {
    const baseline = request.baselines.at(-1);
    const outcome = request.delivery?.at(-1);
    return { id: request.id, payload: { baseline: baseline ? { ...baseline, evaluationSplit: baseline.evaluation?.split ?? "unassigned", workPackageIds: baseline.review.workPackages.map(item => item.id) } : null, estimate: baseline ? { hours: baseline.estimate.baseHours, baseHours: baseline.estimate.baseHours, adjustedHours: baseline.estimate.adjustedHours ?? baseline.estimate.baseHours, low: baseline.estimate.lowHours, high: baseline.estimate.highHours, adjustedLow: baseline.estimate.adjustedLowHours ?? baseline.estimate.lowHours, adjustedHigh: baseline.estimate.adjustedHighHours ?? baseline.estimate.highHours, calibration: baseline.estimate.calibration, calibrationSummary: baseline.estimate.calibrationSummary } : null, reviewedScope: baseline?.review, deliveryOutcome: outcome ? { ...outcome, evaluationSplit: baseline?.evaluation?.split ?? "unassigned", reviewStatus: outcome.status, synthetic: baseline?.evaluation?.cohort !== "recorded", calibrationEligible: Boolean(baseline && baseline.evaluation?.cohort === "recorded" && baseline.evaluation.split === "training" && isIndependentlyReviewedOriginalScopeOutcome(baseline, outcome)), reviewDecisions: outcome.reviewedBy ? [{ actorId: outcome.reviewedBy, decision: outcome.status, at: outcome.reviewedAt, notes: outcome.reviewNotes }] : [] } : null, provenance: { channel: request.channel, cohort: request.cohort ?? "synthetic", createdAt: request.createdAt, createdBy: request.createdBy }, deliveryHistory: request.delivery ?? [] } };
  });
}
