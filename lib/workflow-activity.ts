import type { CompanyConfig } from "./client-workflow-types";
import { createDeliveryEvaluationAccumulator } from "./workflow-evaluation";
import { workflowInsights } from "./workflow-insights";
import { iterateCompanyRequests } from "./workflow-queries";

/** Full-cohort aggregates, independent of inbox filters. Only the next five actions are hydrated into the UI. */
export async function readCompanyActivity(companyId: string, config: CompanyConfig) {
  const evaluation = createDeliveryEvaluationAccumulator();
  const insights = { ...workflowInsights([], config), nextActionCount: 0, committedRequestId: undefined as string | undefined, sampleRequestId: undefined as string | undefined };
  const nextActions: { updatedAt: string; item: typeof insights.nextActions[number] }[] = [];
  let committedAt = "";
  let sampleAt = "";
  for await (const request of iterateCompanyRequests(companyId)) {
    evaluation.add(request);
    const row = workflowInsights([request], config);
    for (const key of ["total", "analyzed", "processing", "proposedTasks", "citedFacts", "totalFacts", "openQuestions", "approvedScopes", "committed"] as const) insights[key] += row[key];
    for (const key of ["total", "reviewed", "accepted", "corrected", "rejected"] as const) insights.findings[key] += row.findings[key];
    insights.nextActionCount += row.nextActions.length;
    if (row.nextActions.length) {
      nextActions.push({ updatedAt: request.updatedAt, item: row.nextActions[0] });
      nextActions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.item.id.localeCompare(a.item.id));
      nextActions.length = Math.min(5, nextActions.length);
    }
    if (request.baselines.length && request.updatedAt >= committedAt) {
      insights.committedRequestId = request.id;
      committedAt = request.updatedAt;
    }
    if (request.cohort === "synthetic" && request.analysis && request.updatedAt >= sampleAt) {
      insights.sampleRequestId = request.id;
      sampleAt = request.updatedAt;
    }
  }
  insights.nextActions = nextActions.map(action => action.item);
  return { evaluation: evaluation.result(), insights };
}

export type CompanyActivityInsights = Awaited<ReturnType<typeof readCompanyActivity>>["insights"];
