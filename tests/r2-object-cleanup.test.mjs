import assert from "node:assert/strict";
import test from "node:test";
import { r2CleanupRetryDelayMs } from "../lib/r2-object-cleanup-policy.ts";

test("R2 cleanup retries back off exponentially and cap at one day", () => {
  assert.equal(r2CleanupRetryDelayMs(1), 2 * 60_000);
  assert.equal(r2CleanupRetryDelayMs(2), 4 * 60_000);
  assert.equal(r2CleanupRetryDelayMs(11), 24 * 60 * 60_000);
  assert.equal(r2CleanupRetryDelayMs(99), 24 * 60 * 60_000);
});

test("invalid R2 cleanup attempt counts use the first retry delay", () => {
  assert.equal(r2CleanupRetryDelayMs(0), 2 * 60_000);
  assert.equal(r2CleanupRetryDelayMs(Number.NaN), 2 * 60_000);
});
