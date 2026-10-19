import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { declareDeliverySplit, evaluateDeliveries, exportDeliveryRecords } from "../lib/workflow-evaluation.ts";

const at = "2026-01-01T00:00:00.000Z";
function row(cohort = "synthetic") {
  return { id: "test-record", title: "FICTIONAL E2E ONLY", baselines: [{ id: "base", sha256: "frozen-digest", createdAt: at, review: { domain: "migration", workPackages: [{ id: "task" }] }, estimate: { baseHours: 10, lowHours: 8, highHours: 14 }, evaluation: { protocol: "the-estimator-delivery-holdout-v1", cohort, domain: "migration", split: "holdout", declaredAt: at } }], delivery: [{ id: "outcome", baselineId: "base", baselineSha256: "frozen-digest", actualHours: { task: 12 }, originalHours: 12, addedScopeHours: 200, evidence: "Fictional time record for a synthetic test only", submittedBy: "estimator", submittedAt: "2026-01-02T00:00:00.000Z", deliveredAt: "2026-01-02T00:00:00.000Z", reviewerId: "reviewer", reviewedBy: "reviewer", reviewedAt: "2026-01-03T00:00:00.000Z", reviewNotes: "Independent reviewer inspected fictional evidence and reconciled the outcome.", status: "approved" }] };
}
test("split matches the documented existing holdout rule", async () => {
  const id = "frozen-record-id";
  const declaration = await declareDeliverySplit("company", id, "synthetic", "migration", at);
  assert.equal(declaration.split, createHash("sha256").update("the-estimator-delivery-holdout-v1:" + id).digest()[0] % 5 === 0 ? "holdout" : "training");
  assert.deepEqual(declaration, await declareDeliverySplit("company", id, "synthetic", "migration", at));
});
test("cohorts remain separate and added scope is excluded", () => {
  const report = evaluateDeliveries([row()]);
  assert.equal(report.recorded.n, 0);
  assert.equal(report.synthetic.n, 1);
  assert.equal(report.synthetic.baseMAEHours, 2);
  assert.equal(report.synthetic.signedBiasHours, -2);
  assert.equal(report.synthetic.rangeCoverage, 1);
});
test("self-approved, mismatched and incomplete actuals are excluded", () => {
  for (const change of [outcome => { outcome.reviewedBy = "estimator"; }, outcome => { outcome.baselineSha256 = "changed"; }, outcome => { outcome.actualHours = {}; }]) {
    const record = row("recorded"); change(record.delivery[0]);
    assert.equal(evaluateDeliveries([record]).recorded.n, 0);
    assert.equal(evaluateDeliveries([record]).counts.excluded, 1);
  }
});
test("training and unreviewed outcomes never become holdout metrics", () => {
  const training = row(); training.baselines[0].evaluation.split = "training";
  const pending = row(); pending.delivery[0].status = "pending";
  const report = evaluateDeliveries([training, pending]);
  assert.equal(report.synthetic.n, 0); assert.equal(report.counts.training, 1); assert.equal(report.counts.pending, 1);
});
test("holdout evaluation reports frozen base and training-adjusted predictions separately", () => {
  const heldOut = row("recorded");
  heldOut.baselines[0].estimate = { baseHours: 10, lowHours: 8, highHours: 12, adjustedHours: 16, adjustedLowHours: 15, adjustedHighHours: 18 };
  heldOut.baselines[0].evaluation.split = "holdout";
  heldOut.delivery[0].originalHours = 12;
  heldOut.delivery[0].actualHours.task = 12;
  const report = evaluateDeliveries([heldOut]);
  assert.equal(report.recorded.n, 1);
  assert.equal(report.recorded.baseMAEHours, 2);
  assert.equal(report.recorded.adjustedMAEHours, 4);
  assert.equal(report.recorded.signedBiasHours, -2);
  assert.equal(report.recorded.adjustedSignedBiasHours, 4);
  assert.equal(report.recorded.rangeCoverage, 1);
  assert.equal(report.recorded.adjustedRangeCoverage, 0);
});
test("exports retain task keys, baseline provenance and independent approval", () => {
  const training = row("recorded"); training.baselines[0].evaluation.split = "training";
  const record = exportDeliveryRecords([training])[0];
  assert.deepEqual(record.payload.baseline.workPackageIds, ["task"]);
  assert.deepEqual(record.payload.deliveryOutcome.actualHours, { task: 12 });
  assert.equal(record.payload.deliveryOutcome.calibrationEligible, true);
  assert.equal(record.payload.deliveryOutcome.reviewDecisions[0].actorId, "reviewer");
  assert.equal(exportDeliveryRecords([row("recorded")])[0].payload.deliveryOutcome.calibrationEligible, false);
});
