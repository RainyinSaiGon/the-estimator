import { evaluateScopeReadiness } from "./review-policy.ts";
import type { ClientRequest, CompanyConfig } from "./client-workflow-types.ts";

// Observed workflow counts; these are not model-quality or accuracy scores.
export function workflowInsights(requests: ClientRequest[], config?: CompanyConfig) {
  const findings = { total: 0, reviewed: 0, accepted: 0, corrected: 0, rejected: 0 };
  let analyzed = 0;
  let processing = 0;
  let proposedTasks = 0;
  let citedFacts = 0;
  let totalFacts = 0;
  let openQuestions = 0;
  let approvedScopes = 0;
  let committed = 0;
  const nextActions: { id: string; title: string; tasks: number; questions: number; findings: number; action: string }[] = [];
  for (const request of requests) {
    const analysis = request.analysis;
    const readiness = evaluateScopeReadiness(request, request.review, config);
    if (request.status === "analyzing") processing++;
    const frozen = request.baselines.length > 0;
    if (frozen) committed++;
    if (request.review.confirmed || frozen) approvedScopes++;
    let remainingFindings = 0;
    let remainingQuestions = 0;
    if (analysis) {
      analyzed++;
      proposedTasks += analysis.workPackages.length;
      totalFacts += analysis.facts.length;
      citedFacts += analysis.facts.filter(fact => fact.status === "source" && fact.source.trim() && fact.evidence.trim()).length;
      for (const key of ["total", "reviewed", "accepted", "corrected", "rejected"] as const) findings[key] += readiness.findings[key];
      remainingFindings = readiness.findings.unresolved;
      remainingQuestions = readiness.questions.unresolved;
      if (!frozen) openQuestions += remainingQuestions;
    }
    if (!frozen && request.status !== "analyzing") {
      const action = request.status === "analysis_failed" ? "Retry analysis"
        : !analysis ? "Analyze brief"
          : request.review.confirmed && readiness.ready ? (request.estimate ? "Commit plan" : "Calculate effort") : "Review scope";
      nextActions.push({ id: request.id, title: request.title, tasks: request.review.workPackages.length, questions: remainingQuestions, findings: remainingFindings, action });
    }
  }
  return { total: requests.length, analyzed, processing, proposedTasks, citedFacts, totalFacts, openQuestions, approvedScopes, committed, findings, nextActions };
}
