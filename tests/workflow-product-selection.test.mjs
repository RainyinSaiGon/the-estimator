import assert from "node:assert/strict";
import test from "node:test";
import { configuredProductId } from "../lib/workflow-product-selection.ts";

test("unconfigured AI product IDs become Unknown", () => {
  assert.equal(configuredProductId("invented-product", []), "");
  assert.equal(configuredProductId("unknown", [{ id: "onboarding" }]), "");
});
test("configured product IDs retain their exact selection", () => {
  assert.equal(configuredProductId("onboarding", [{ id: "onboarding" }]), "onboarding");
});
test("empty and retired draft selections remain Unknown", () => {
  assert.equal(configuredProductId("", [{ id: "onboarding" }]), "");
  assert.equal(configuredProductId("retired-product", [{ id: "onboarding" }]), "");
});
