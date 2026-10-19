import type { ClientRequest, CompanyConfig, ScopeReview } from "../../lib/client-workflow-types";
import { configuredProductId } from "../../lib/workflow-product-selection";

export { requestTypes as types } from "../../lib/client-workflow-types";

export const typeLabel: Record<string, string> = {
  demo: "Demo inquiry",
  setup: "Product setup",
  migration: "Migration",
  integration: "Integration",
  customization: "Customization",
  support: "Support",
};

export function requestStatusLabel(status: ClientRequest["status"]) {
  return {
    received: "Brief received",
    analyzing: "AI analyzing",
    needs_review: "Needs review",
    scope_confirmed: "Scope approved",
    estimated: "Effort calculated",
    frozen: "Plan committed",
    analysis_failed: "Analysis needs retry",
  }[status];
}

export function requestStatusTone(status: ClientRequest["status"]) {
  if (status === "frozen") return "bg-emerald-100 text-emerald-900";
  if (status === "analysis_failed") return "bg-red-100 text-red-900";
  if (status === "estimated" || status === "scope_confirmed")
    return "bg-violet-100 text-violet-900";
  if (status === "analyzing") return "bg-sky-100 text-sky-900";
  return "bg-amber-100 text-amber-950";
}

export function reviewForEditor(
  request: ClientRequest,
  products: CompanyConfig["products"],
): ScopeReview {
  const review = structuredClone(request.review);
  if (request.status !== "frozen")
    review.productId = configuredProductId(review.productId, products);
  return review;
}
