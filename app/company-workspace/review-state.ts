import type { ClientRequest, Company, ScopeReview } from "../../lib/client-workflow-types";

export function getScopeReviewState(
  request: ClientRequest | null,
  review: ScopeReview | null,
  company: Company | null,
) {
  const questionResolutions = review?.questionResolutions ?? {};
  const findingReviews = review?.findingReviews ?? {};
  const questionRows =
    request?.analysis?.questions.map((question, index) => ({
      key: `analysis:${index}`,
      question,
      value: questionResolutions[`analysis:${index}`],
    })) ?? [];
  const reviewerQuestionRows = Object.entries(questionResolutions)
    .filter(([key, value]) => key.startsWith("review:") && value.question?.trim())
    .map(([key, value]) => ({ key, question: value.question!, value }));
  const unresolvedQuestions = [...questionRows, ...reviewerQuestionRows].filter(
    ({ value }) => !value?.disposition || !value.resolution.trim(),
  ).length;
  const findingKeys = request?.analysis
    ? [
        ...request.analysis.facts.map((_, index) => `fact:${index}`),
        ...request.analysis.productFindings.map((_, index) => `product:${index}`),
        ...request.analysis.capabilityFindings.map((_, index) => `capability:${index}`),
        ...request.analysis.assumptions.map((_, index) => `assumption:${index}`),
        ...request.analysis.conflicts.map((_, index) => `conflict:${index}`),
      ]
    : [];
  const unreviewedFindings = findingKeys.filter((key) => {
    const finding = findingReviews[key];
    return (
      !finding?.disposition ||
      ((finding.disposition === "corrected" || finding.disposition === "rejected") &&
        !finding.correction.trim())
    );
  }).length;
  const missingRequiredFields =
    review && company
      ? company.config.fields
          .filter(
            (field) =>
              field.required &&
              field.requestTypes.includes(review.requestType) &&
              !review.fieldAnswers?.[field.key]?.trim(),
          )
          .map((field) => field.label)
      : [];
  const reviewBlockers = review
    ? [
        ...(!review.deliverables.trim() ? ["Add at least one deliverable."] : []),
        ...(!review.domain?.trim() ? ["Set the reviewed work domain."] : []),
        ...(!review.acceptance.trim() ? ["Write the overall completion criteria."] : []),
        ...(!review.dependencies.trim()
          ? ["State the prerequisites and owners, or enter “None identified.”"]
          : []),
        ...(review.workPackages.length === 0 ? ["Add at least one work package."] : []),
        ...(review.workPackages.some((item) => !item.acceptance.trim())
          ? ["Add completion criteria to each work package."]
          : []),
        ...(review.workPackages.some((item) => !item.dependencies.trim())
          ? ["State prerequisites for each work package, or enter “None identified.”"]
          : []),
        ...(unresolvedQuestions
          ? [
              `Resolve all ${unresolvedQuestions} open question${unresolvedQuestions === 1 ? "" : "s"}.`,
            ]
          : []),
        ...(unreviewedFindings
          ? [`Review all ${unreviewedFindings} AI finding${unreviewedFindings === 1 ? "" : "s"}.`]
          : []),
        ...(missingRequiredFields.length
          ? [`Complete required fields: ${missingRequiredFields.join(", ")}.`]
          : []),
        ...(request?.attachments.some((file) => file.status !== "extracted" || file.truncated) &&
        !review.sourceLimitationsAcknowledged
          ? ["Reconcile incomplete source files and acknowledge their limitations."]
          : []),
      ]
    : [];
  return {
    findingReviews,
    questionRows,
    reviewerQuestionRows,
    reviewBlockers,
  };
}

export type ScopeReviewState = ReturnType<typeof getScopeReviewState>;
