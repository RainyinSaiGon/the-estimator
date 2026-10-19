import type { ClientRequest, DeliveryEvaluation, EvaluationDeclaration, EvaluationMetrics } from "./client-workflow-types";

export async function declareDeliverySplit(companyId: string, requestId: string, cohort: "synthetic" | "recorded", domain: string, at: string): Promise<EvaluationDeclaration> {
  void companyId;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`the-estimator-delivery-holdout-v1:${requestId}`));
  const bucket = new Uint8Array(bytes)[0] % 5;
  return { protocol: "the-estimator-delivery-holdout-v1", cohort, domain, split: bucket === 0 ? "holdout" : "training", declaredAt: at };
}

export function evaluateDeliveries(requests: ClientRequest[]): DeliveryEvaluation {
  const samples: Record<"recorded" | "synthetic", { predicted: number; actual: number; low: number; high: number; domain: string }[]> = { recorded: [], synthetic: [] };
  const counts = { frozen: 0, pending: 0, rejected: 0, excluded: 0, training: 0 };
  for (const request of requests) {
    if (request.baselines.length) counts.frozen++;
    for (const outcome of request.delivery ?? []) {
      if (outcome.status === "pending") { counts.pending++; continue; }
      if (outcome.status === "rejected") { counts.rejected++; continue; }
      const base = request.baselines.find(item => item.id === outcome.baselineId && item.sha256 === outcome.baselineSha256);
      const declaration = base?.evaluation;
      const actualIds = Object.keys(outcome.actualHours ?? {});
      const expectedIds = base?.review.workPackages.map(item => item.id) ?? [];
      if (!base || !declaration || !outcome.reviewedBy || outcome.reviewedBy === outcome.submittedBy || outcome.reviewedBy !== outcome.reviewerId || !outcome.evidence.trim() || outcome.originalHours <= 0 || declaration.declaredAt > outcome.submittedAt || base.createdAt > outcome.deliveredAt || !expectedIds.length || actualIds.length !== expectedIds.length || expectedIds.some(id => !Number.isFinite(outcome.actualHours[id]) || outcome.actualHours[id] < 0)) { counts.excluded++; continue; }
      if (declaration.split === "training") { counts.training++; continue; }
      samples[declaration.cohort].push({ predicted: base.estimate.baseHours, actual: outcome.originalHours, low: base.estimate.lowHours, high: base.estimate.highHours, domain: declaration.domain });
    }
  }
  function metrics(cohort: "recorded" | "synthetic"): EvaluationMetrics {
    const rows = samples[cohort];
    const mean = (fn: (row: typeof rows[number]) => number) => rows.length ? Number((rows.reduce((sum, row) => sum + fn(row), 0) / rows.length).toFixed(4)) : null;
    return { n: rows.length, baseMAEHours: mean(row => Math.abs(row.predicted - row.actual)), adjustedMAEHours: mean(row => Math.abs(row.predicted - row.actual)), signedBiasHours: mean(row => row.predicted - row.actual), rangeCoverage: mean(row => Number(row.actual >= row.low && row.actual <= row.high)), domains: rows.reduce<Record<string, number>>((result, row) => ({ ...result, [row.domain]: (result[row.domain] ?? 0) + 1 }), {}) };
  }
  const recorded = metrics("recorded");
  return { protocol: "the-estimator-delivery-holdout-v1", methodology: "SHA-256(the-estimator-delivery-holdout-v1:<record-id>)[0] modulo 5; bucket 0 is holdout (20%). Declaration is frozen before delivery. Only independently approved original-scope task actuals count. Added scope is excluded. This engine has no learned adjustment: base and adjusted predictions are identical. No outcomes are used in calibration or method selection.", counts, recorded, synthetic: metrics("synthetic"), warnings: [recorded.n === 0 ? "No eligible recorded holdout outcomes are available." : recorded.n < 30 ? "The recorded holdout is small; descriptive results cannot establish accuracy or improvement." : "Sample size alone does not establish representativeness or improvement.", "Work domains, customer mix, selection bias and evidence quality require human review. Synthetic results are separate and cannot support recorded-performance claims.", "Legacy baselines without a predeclared split are excluded. Issues #38 and #39 still require real representative approved evidence."] };
}

export function exportDeliveryRecords(requests: ClientRequest[]) {
  return requests.map(request => {
    const baseline = request.baselines.at(-1);
    const outcome = request.delivery?.at(-1);
    return { id: request.id, payload: { baseline: baseline ? { ...baseline, evaluationSplit: baseline.evaluation?.split ?? "unassigned", workPackageIds: baseline.review.workPackages.map(item => item.id) } : null, estimate: baseline ? { hours: baseline.estimate.baseHours, baseHours: baseline.estimate.baseHours, low: baseline.estimate.lowHours, high: baseline.estimate.highHours } : null, reviewedScope: baseline?.review, deliveryOutcome: outcome ? { ...outcome, evaluationSplit: baseline?.evaluation?.split ?? "unassigned", reviewStatus: outcome.status, synthetic: baseline?.evaluation?.cohort !== "recorded", calibrationEligible: outcome.status === "approved" && baseline?.evaluation?.cohort === "recorded" && !!outcome.reviewedBy && outcome.reviewedBy !== outcome.submittedBy && outcome.reviewedBy === outcome.reviewerId, reviewDecisions: outcome.reviewedBy ? [{ actorId: outcome.reviewedBy, decision: outcome.status, at: outcome.reviewedAt, notes: outcome.reviewNotes }] : [] } : null, provenance: { channel: request.channel, cohort: request.cohort ?? "synthetic", createdAt: request.createdAt, createdBy: request.createdBy }, deliveryHistory: request.delivery ?? [] } };
  });
}
