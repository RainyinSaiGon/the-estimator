import assert from "node:assert/strict";
import test from "node:test";
import { workflowInsights } from "../lib/workflow-insights.ts";

function request(overrides = {}) {
  return {
    id: "request-one", title: "Client brief", status: "needs_review", baselines: [], attachments: [],
    review: {
      confirmed: false, requestType: "integration", domain: "CRM integration",
      deliverables: "Import customer contacts.", acceptance: "The agreed contact sample reconciles.",
      dependencies: "Customer provides the export.", questions: ["Who owns the export?"],
      workPackages: [{ id: "task-one", acceptance: "Import reconciles.", dependencies: "Customer export is available." }],
      findingReviews: {}, questionResolutions: {},
    },
    analysis: {
      facts: [{ status: "source", source: "brief.pdf · page 2", evidence: "Import the contacts." }, { status: "inference", source: "", evidence: "" }],
      productFindings: [{ status: "unknown" }], capabilityFindings: [], assumptions: [], conflicts: [],
      questions: ["Who owns the export?"], workPackages: [{ id: "task-one" }],
    }, ...overrides,
  };
}

test("empty workspaces show zero activity and no invented performance", () => {
  const summary = workflowInsights([]);
  assert.equal(summary.analyzed, 0);
  assert.equal(summary.findings.reviewed, 0);
  assert.deepEqual(summary.nextActions, []);
  assert.equal("accuracy" in summary, false);
});

test("only current, complete reviewer decisions and cited facts are counted", () => {
  const item = request();
  item.review.findingReviews = {
    "fact:0": { disposition: "accepted", correction: "" },
    "fact:1": { disposition: "corrected", correction: " " },
    "product:0": { disposition: "rejected", correction: "The configured product does not match." },
    "fact:999": { disposition: "accepted", correction: "" },
  };
  item.review.questionResolutions = {
    "analysis:0": { disposition: "answered", resolution: "Customer supplies the export." },
    "analysis:999": { disposition: "answered", resolution: "Stale answer." },
    "review:extra": { question: "Who approves delivery?", resolution: "" },
  };
  const summary = workflowInsights([item]);
  assert.deepEqual(summary.findings, { total: 3, reviewed: 2, accepted: 1, corrected: 0, rejected: 1 });
  assert.equal(summary.citedFacts, 1);
  assert.equal(summary.openQuestions, 1);
  assert.equal(summary.nextActions[0].findings, 1);
  assert.equal(summary.nextActions[0].action, "Review scope");
});

test("legacy committed plans stay out of the active review queue", () => {
  const summary = workflowInsights([request({ status: "frozen", baselines: [{ id: "baseline" }] })]);
  assert.equal(summary.committed, 1);
  assert.equal(summary.approvedScopes, 1);
  assert.equal(summary.openQuestions, 0);
  assert.equal(summary.findings.total, 3);
  assert.equal(summary.findings.reviewed, 0);
  assert.deepEqual(summary.nextActions, []);
});

test("next actions distinguish failed analysis, ongoing analysis and an approved plan", () => {
  const failed = request({ id: "failed", status: "analysis_failed", analysis: undefined });
  const running = request({ id: "running", status: "analyzing", analysis: undefined });
  const ready = request({ id: "ready", status: "estimated", estimate: {} });
  ready.review.confirmed = true;
  ready.review.findingReviews = Object.fromEntries(["fact:0", "fact:1", "product:0"].map(key => [key, { disposition: "accepted", correction: "" }]));
  ready.review.questionResolutions = { "analysis:0": { disposition: "answered", resolution: "Customer owns the export." } };
  const summary = workflowInsights([failed, running, ready]);
  assert.equal(summary.processing, 1);
  assert.deepEqual(summary.nextActions.map(item => [item.id, item.action]), [["failed", "Retry analysis"], ["ready", "Commit plan"]]);
});

test("an old scope approval cannot hide unresolved review decisions in the next-action queue", () => {
  const legacy = request({ status: "estimated", estimate: {} });
  legacy.review.confirmed = true;
  const summary = workflowInsights([legacy]);
  assert.equal(summary.nextActions[0].action, "Review scope");
  assert.equal(summary.nextActions[0].findings, 3);
  assert.equal(summary.nextActions[0].questions, 1);
});
