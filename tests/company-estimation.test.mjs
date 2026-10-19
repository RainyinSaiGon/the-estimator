import assert from "node:assert/strict";
import test from "node:test";
import { applyApprovedTrainingHistory, scopeReviewBlockers } from "../lib/client-workflow-types.ts";

const domain = "fund administration integration";
const review = {
  requestType: "integration",
  domain,
  workPackages: [],
};

function trainingRequest({ id, ratio = 1, split = "training", cohort = "recorded", status = "approved", independent = true, digestMatches = true, historyDomain = domain, historyType = "integration", complexity = "medium", reviewNotes = "I inspected the reconciled time record and scope evidence." }) {
  const workPackage = { id: `${id}-package`, taskId: "implementation", quantity: 1, complexity, owner: "company", acceptance: "Complete the configured change.", dependencies: "None identified." };
  const baseline = {
    id: `${id}-baseline`,
    sha256: `${id}-digest`,
    createdAt: "2026-01-01T00:00:00.000Z",
    review: { ...review, requestType: historyType, domain: historyDomain, workPackages: [workPackage] },
    estimate: { tasks: [{ templateId: "implementation", baseHours: 10, lowHours: 8, highHours: 14 }] },
    evaluation: { protocol: "the-estimator-delivery-holdout-v1", cohort, domain: historyDomain, split, declaredAt: "2026-01-01T00:00:00.000Z" },
  };
  return {
    id,
    cohort,
    baselines: [baseline],
    delivery: [{
      id: `${id}-outcome`,
      baselineId: baseline.id,
      baselineSha256: digestMatches ? baseline.sha256 : "changed-digest",
      actualHours: { [workPackage.id]: 10 * ratio },
      originalHours: 10 * ratio,
      addedScopeHours: 500,
      evidence: "Reconciled original-scope time record and delivery evidence.",
      submittedBy: `${id}-estimator`,
      submittedAt: "2026-03-01T00:00:00.000Z",
      deliveredAt: "2026-02-28T00:00:00.000Z",
      reviewerId: "reviewer-1",
      status,
      ...(independent ? { reviewedBy: "reviewer-1", reviewedAt: "2026-03-02T00:00:00.000Z", reviewNotes } : { reviewedBy: `${id}-estimator`, reviewedAt: "2026-03-02T00:00:00.000Z", reviewNotes }),
    }],
  };
}

const estimateTasks = [{ templateId: "implementation", label: "Implementation", quantity: 1, baseHours: 10, lowHours: 8, highHours: 14, complexity: "medium", assumptions: [] }];

test("calibration uses a task-specific median from matching approved recorded training projects", () => {
  const history = [trainingRequest({ id: "project-a", ratio: 1 }), trainingRequest({ id: "project-b", ratio: 1.5 }), trainingRequest({ id: "project-c", ratio: 2 })];
  const result = applyApprovedTrainingHistory(estimateTasks, review, history);
  assert.equal(result.calibration, "training-history");
  assert.equal(result.tasks[0].calibrationFactor, 1.5);
  assert.equal(result.tasks[0].calibrationSamples, 3);
  assert.equal(result.adjustedHours, 15);
  assert.equal(result.adjustedLowHours, 12);
  assert.equal(result.adjustedHighHours, 21);
  assert.equal(result.calibrationSummary.method, "approved-recorded-training-median-v1");
  assert.equal(result.calibrationSummary.sourceBaselineIds.length, 3);
  assert.equal(result.calibrationSummary.taskSamples["implementation\u001fmedium"], 3);
  assert.match(result.tasks[0].assumptions.at(-1), /independently approved recorded training projects matching/);
  const highComplexity = applyApprovedTrainingHistory([{ ...estimateTasks[0], complexity: "high" }], review, history);
  assert.equal(highComplexity.tasks[0].adjustedHours, 10);
  assert.equal(highComplexity.calibration, "uncalibrated");
});

test("holdout, synthetic, pending, self-reviewed, digest-mismatched, and noncomparable records cannot calibrate", () => {
  const history = [
    trainingRequest({ id: "holdout", split: "holdout" }),
    trainingRequest({ id: "synthetic", cohort: "synthetic" }),
    trainingRequest({ id: "pending", status: "pending" }),
    trainingRequest({ id: "self-review", independent: false }),
    trainingRequest({ id: "changed", digestMatches: false }),
    trainingRequest({ id: "other-domain", historyDomain: "migration" }),
    trainingRequest({ id: "other-type", historyType: "migration" }),
  ];
  const result = applyApprovedTrainingHistory(estimateTasks, review, history);
  assert.equal(result.calibration, "uncalibrated");
  assert.equal(result.adjustedHours, 10);
  assert.equal(result.calibrationSummary.sourceBaselineIds.length, 0);
  assert.equal(result.calibrationSummary.excluded.holdout, 1);
  assert.equal(result.calibrationSummary.excluded.synthetic, 1);
  assert.ok(result.calibrationSummary.excluded.unreviewedOrInvalid >= 2);
  assert.equal(result.calibrationSummary.excluded.notComparable, 2);
});

test("a task needs three independent projects and extreme ratios are capped", () => {
  const tooFew = applyApprovedTrainingHistory(estimateTasks, review, [trainingRequest({ id: "one", ratio: 10 }), trainingRequest({ id: "two", ratio: 10 })]);
  assert.equal(tooFew.calibration, "uncalibrated");
  assert.equal(tooFew.adjustedHours, 10);
  const enough = applyApprovedTrainingHistory(estimateTasks, review, [trainingRequest({ id: "one", ratio: 10 }), trainingRequest({ id: "two", ratio: 10 }), trainingRequest({ id: "three", ratio: 10 })]);
  assert.equal(enough.tasks[0].calibrationFactor, 2);
  assert.equal(enough.adjustedHours, 20);
});

test("scope blockers require explicit acceptance, dependencies, question resolutions, and finding decisions", () => {
  const analysis = { questions: ["Which CRM is in scope?"], facts: [{}, {}], productFindings: [{}, {}], capabilityFindings: [{}], assumptions: [{}], conflicts: [{}] };
  const readyReview = {
    questions: [...analysis.questions],
    acceptance: "Contacts migrate and reconcile against the agreed sample.",
    dependencies: "Customer provides access; no vendor dependency is known.",
    workPackages: [{ acceptance: "Validation passes.", dependencies: "Customer supplies a test account." }],
    questionResolutions: {
      "analysis:0": { disposition: "answered", resolution: "Salesforce is the source CRM." },
      "review:123e4567-e89b-42d3-a456-426614174000": { question: "Is historical activity included?", disposition: "not_applicable", resolution: "Excluded by the approved scope." },
    },
    findingReviews: {
      "fact:0": { disposition: "accepted", correction: "" },
      "fact:1": { disposition: "corrected", correction: "The source is the customer-provided export." },
      "product:0": { disposition: "rejected", correction: "No approved product source supports the original fit claim." },
      "product:1": { disposition: "accepted", correction: "" },
      "capability:0": { disposition: "accepted", correction: "" },
      "assumption:0": { disposition: "accepted", correction: "" },
      "conflict:0": { disposition: "accepted", correction: "" },
    },
  };
  assert.deepEqual(scopeReviewBlockers(readyReview, analysis), []);
  assert.ok(scopeReviewBlockers({ ...readyReview, dependencies: " ", questionResolutions: { "analysis:0": { resolution: "" } } }, analysis).length > 0);
  assert.ok(scopeReviewBlockers({ ...readyReview, findingReviews: { ...readyReview.findingReviews, "fact:1": { disposition: "corrected", correction: "" } } }, analysis).length > 0);
  assert.ok(scopeReviewBlockers({ ...readyReview, questions: ["Edited in the review"] }, analysis).length > 0);
});
