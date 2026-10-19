import type {
  ClientAnalysis,
  ClientRequest,
  CompanyConfig,
  ScopeReview,
} from "./client-workflow-types.ts";

export type ReviewBlockerCode =
  | "analysis_required"
  | "acceptance_required"
  | "dependencies_required"
  | "work_package_acceptance_required"
  | "work_package_dependencies_required"
  | "original_questions_changed"
  | "analysis_question_resolution_required"
  | "unsupported_analysis_question"
  | "reviewer_question_invalid"
  | "reviewer_question_resolution_required"
  | "finding_review_required"
  | "unsupported_finding"
  | "deliverables_required"
  | "domain_required"
  | "work_package_required"
  | "required_fields_missing"
  | "source_limitations_unacknowledged";

export type ReviewBlocker = {
  code: ReviewBlockerCode;
  keys?: string[];
  labels?: string[];
};

type QuestionResolution = NonNullable<ScopeReview["questionResolutions"]>[string];
export type ReviewQuestionRow = {
  key: string;
  question: string;
  value: QuestionResolution | undefined;
};

const hasText = (value: string | undefined): boolean =>
  typeof value === "string" && !!value.trim();
const reviewerQuestionKey = /^review:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function answered(value: QuestionResolution | undefined): boolean {
  return !!value &&
    (value.disposition === "answered" || value.disposition === "not_applicable") &&
    hasText(value.resolution);
}

/** Pure review decisions shared by editor, command validation, and activity summaries. */
export function evaluateReviewDecisions(review: ScopeReview, analysis: ClientAnalysis) {
  const blockers: ReviewBlocker[] = [];
  const questionResolutions = review.questionResolutions ?? {};
  const findingReviews = review.findingReviews ?? {};
  const questionRows: ReviewQuestionRow[] = analysis.questions.map((question, index) => ({
    key: `analysis:${index}`,
    question,
    value: questionResolutions[`analysis:${index}`],
  }));
  const reviewerQuestionRows: ReviewQuestionRow[] = Object.entries(questionResolutions)
    .filter(([key]) => !key.startsWith("analysis:"))
    .map(([key, value]) => ({ key, question: value.question ?? "", value }));
  const unresolvedAnalysis = questionRows
    .filter(row => !answered(row.value))
    .map(row => row.key);
  const unresolvedReviewer = reviewerQuestionRows
    .filter(row => !answered(row.value) || !hasText(row.question))
    .map(row => row.key);
  const invalidReviewer = reviewerQuestionRows
    .filter(row => !reviewerQuestionKey.test(row.key) || !hasText(row.question))
    .map(row => row.key);
  const unsupportedAnalysis = Object.keys(questionResolutions).filter(key => {
    if (!key.startsWith("analysis:")) return false;
    const match = /^analysis:(0|[1-9]\d*)$/.exec(key);
    return !match || Number(match[1]) >= analysis.questions.length;
  });

  if (!hasText(review.acceptance)) blockers.push({ code: "acceptance_required" });
  if (!hasText(review.dependencies)) blockers.push({ code: "dependencies_required" });
  if (review.workPackages.some(item => !hasText(item.acceptance)))
    blockers.push({ code: "work_package_acceptance_required" });
  if (review.workPackages.some(item => !hasText(item.dependencies)))
    blockers.push({ code: "work_package_dependencies_required" });
  if (
    review.questions?.length !== analysis.questions.length ||
    review.questions?.some((question, index) => question !== analysis.questions[index])
  ) blockers.push({ code: "original_questions_changed" });
  if (unresolvedAnalysis.length) blockers.push({ code: "analysis_question_resolution_required", keys: unresolvedAnalysis });
  if (unsupportedAnalysis.length) blockers.push({ code: "unsupported_analysis_question", keys: unsupportedAnalysis });
  if (invalidReviewer.length) blockers.push({ code: "reviewer_question_invalid", keys: invalidReviewer });
  if (unresolvedReviewer.length) blockers.push({ code: "reviewer_question_resolution_required", keys: unresolvedReviewer });

  const findingKeys = [
    ...(analysis.facts ?? []).map((_, index) => `fact:${index}`),
    ...(analysis.productFindings ?? []).map((_, index) => `product:${index}`),
    ...(analysis.capabilityFindings ?? []).map((_, index) => `capability:${index}`),
    ...(analysis.assumptions ?? []).map((_, index) => `assumption:${index}`),
    ...(analysis.conflicts ?? []).map((_, index) => `conflict:${index}`),
  ];
  const findingKeySet = new Set(findingKeys);
  const findings = { total: findingKeys.length, reviewed: 0, accepted: 0, corrected: 0, rejected: 0, unresolved: 0 };
  const unreviewed: string[] = [];
  for (const key of findingKeys) {
    const decision = findingReviews[key];
    if (
      decision?.disposition === "accepted" ||
      ((decision?.disposition === "corrected" || decision?.disposition === "rejected") &&
        hasText(decision.correction))
    ) {
      findings.reviewed++;
      findings[decision.disposition]++;
    } else unreviewed.push(key);
  }
  findings.unresolved = unreviewed.length;
  const unsupportedFindings = Object.keys(findingReviews)
    .filter(key => !findingKeySet.has(key));
  if (unreviewed.length)
    blockers.push({ code: "finding_review_required", keys: unreviewed });
  if (unsupportedFindings.length)
    blockers.push({ code: "unsupported_finding", keys: unsupportedFindings });
  const unresolved = new Set([...unresolvedAnalysis, ...unresolvedReviewer, ...invalidReviewer]).size;
  const total = questionRows.length + reviewerQuestionRows.length;
  return {
    ready: blockers.length === 0,
    blockers,
    findingReviews,
    findings,
    questionRows,
    reviewerQuestionRows,
    questions: { total, resolved: total - unresolved, unresolved },
  };
}

/** Full confirmation readiness; independent of storage, identity, and presentation. */
export function evaluateScopeReadiness(
  request: Pick<ClientRequest, "analysis" | "attachments">,
  review: ScopeReview,
  config?: Pick<CompanyConfig, "fields">,
) {
  if (!request.analysis) return {
    ready: false,
    blockers: [{ code: "analysis_required" }] as ReviewBlocker[],
    findingReviews: review.findingReviews ?? {},
    findings: { total: 0, reviewed: 0, accepted: 0, corrected: 0, rejected: 0, unresolved: 0 },
    questions: { total: 0, resolved: 0, unresolved: 0 },
    questionRows: [] as ReviewQuestionRow[],
    reviewerQuestionRows: [] as ReviewQuestionRow[],
  };
  const result = evaluateReviewDecisions(review, request.analysis);
  const blockers = [...result.blockers];
  if (!hasText(review.deliverables)) blockers.push({ code: "deliverables_required" });
  if (!hasText(review.domain)) blockers.push({ code: "domain_required" });
  if (!review.workPackages.length) blockers.push({ code: "work_package_required" });
  const missing = config?.fields.filter(field =>
    field.required &&
    field.requestTypes.includes(review.requestType) &&
    !hasText(review.fieldAnswers?.[field.key])
  ) ?? [];
  if (missing.length) blockers.push({
    code: "required_fields_missing",
    keys: missing.map(field => field.key),
    labels: missing.map(field => field.label),
  });
  if (
    (request.attachments ?? []).some(file => file.status !== "extracted" || file.truncated) &&
    !review.sourceLimitationsAcknowledged
  ) blockers.push({ code: "source_limitations_unacknowledged" });
  return { ...result, blockers, ready: blockers.length === 0 };
}

export type ScopeReadiness = ReturnType<typeof evaluateScopeReadiness>;
