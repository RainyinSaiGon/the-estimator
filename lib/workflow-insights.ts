import type { ClientRequest } from "./client-workflow-types.ts";

// Observed workflow counts; these are not model-quality or accuracy scores.
export function workflowInsights(requests: ClientRequest[]) {
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
      const keys = [
        ...analysis.facts.map((_, i) => `fact:${i}`),
        ...analysis.productFindings.map((_, i) => `product:${i}`),
        ...analysis.capabilityFindings.map((_, i) => `capability:${i}`),
        ...analysis.assumptions.map((_, i) => `assumption:${i}`),
        ...analysis.conflicts.map((_, i) => `conflict:${i}`),
      ];
      findings.total += keys.length;
      for (const key of keys) {
        const decision = request.review.findingReviews?.[key];
        if (decision && ["accepted", "corrected", "rejected"].includes(decision.disposition) && (decision.disposition === "accepted" || decision.correction?.trim())) {
          findings.reviewed++;
          findings[decision.disposition]++;
        } else remainingFindings++;
      }
      const answers = request.review.questionResolutions ?? {};
      remainingQuestions = analysis.questions.filter((_, i) => {
        const answer = answers[`analysis:${i}`];
        return !answer || !["answered", "not_applicable"].includes(answer.disposition ?? "") || !answer.resolution.trim();
      }).length;
      remainingQuestions += Object.entries(answers).filter(([key, answer]) => key.startsWith("review:") && answer.question?.trim() && (!answer.disposition || !answer.resolution.trim())).length;
      if (!frozen) openQuestions += remainingQuestions;
    }
    if (!frozen && request.status !== "analyzing") {
      const action = request.status === "analysis_failed" ? "Retry analysis"
        : !analysis ? "Analyze brief"
          : request.review.confirmed && remainingFindings === 0 && remainingQuestions === 0 ? (request.estimate ? "Commit plan" : "Calculate effort") : "Review scope";
      nextActions.push({ id: request.id, title: request.title, tasks: request.review.workPackages.length, questions: remainingQuestions, findings: remainingFindings, action });
    }
  }
  return { total: requests.length, analyzed, processing, proposedTasks, citedFacts, totalFacts, openQuestions, approvedScopes, committed, findings, nextActions };
}
