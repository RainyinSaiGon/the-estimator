import type { ClientRequest, Company, ScopeReview } from "../../lib/client-workflow-types";
import { evaluateScopeReadiness } from "../../lib/review-policy";
import { reviewBlockerMessages } from "../../lib/review-policy-messages";

export function getScopeReviewState(
  request: ClientRequest | null,
  review: ScopeReview | null,
  company: Company | null,
) {
  const readiness = request && review
    ? evaluateScopeReadiness(request, review, company?.config)
    : null;
  return {
    findingReviews: readiness?.findingReviews ?? {},
    questionRows: readiness?.questionRows ?? [],
    reviewerQuestionRows: readiness?.reviewerQuestionRows ?? [],
    reviewBlockers: readiness ? reviewBlockerMessages(readiness.blockers, "editor") : [],
    readiness,
  };
}

export type ScopeReviewState = ReturnType<typeof getScopeReviewState>;
