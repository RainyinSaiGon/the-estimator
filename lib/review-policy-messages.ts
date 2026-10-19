import type { ReviewBlocker } from "./review-policy.ts";

/** Presentation wording is kept outside the review decisions. */
export function reviewBlockerMessages(blockers: readonly ReviewBlocker[], audience: "editor" | "server" = "server"): string[] {
  const messages = blockers.map(blocker => {
    switch (blocker.code) {
      case "analysis_required": return "Analyze the request before confirming or estimating its scope.";
      case "acceptance_required": return audience === "editor" ? "Write the overall completion criteria." : "Add global acceptance criteria, or explicitly state that no additional criteria apply.";
      case "dependencies_required": return audience === "editor" ? "State the prerequisites and owners, or enter “None identified.”" : "Describe the prerequisites and their owners, or explicitly state that no dependencies are known.";
      case "work_package_acceptance_required": return "Add completion criteria to each work package.";
      case "work_package_dependencies_required": return "State prerequisites for each work package, or enter “None identified.”";
      case "original_questions_changed": return "Keep the original analysis questions unchanged; resolve them individually below.";
      case "analysis_question_resolution_required": return "Resolve every analysis question with an answer or not-applicable rationale.";
      case "unsupported_analysis_question": return `Remove unsupported analysis-question resolution entries: ${blocker.keys?.join(", ")}.`;
      case "reviewer_question_invalid": return `Use a valid reviewer-question identifier and nonempty question text, or remove the invalid entries: ${blocker.keys?.join(", ")}.`;
      case "reviewer_question_resolution_required": return "Resolve every reviewer-added question with an answer or not-applicable rationale.";
      case "finding_review_required": return "Review every extracted fact and product or capability finding. Add a correction or reason when changing or rejecting a finding.";
      case "unsupported_finding": return `Remove unsupported finding-review entries: ${blocker.keys?.join(", ")}.`;
      case "deliverables_required": return audience === "editor" ? "Add at least one deliverable." : "Add at least one deliverable before confirming the scope.";
      case "domain_required": return audience === "editor" ? "Set the reviewed work domain." : "Add a reviewed work domain before confirming the scope.";
      case "work_package_required": return "Add at least one work package.";
      case "required_fields_missing": return `Complete required fields: ${blocker.labels?.join(", ")}.`;
      case "source_limitations_unacknowledged": return audience === "editor" ? "Reconcile incomplete source files and acknowledge their limitations." : "Reconcile incomplete sources and acknowledge their limitations before confirming scope.";
    }
  });
  return [...new Set(messages)];
}
