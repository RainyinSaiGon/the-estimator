import { createHmac } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const endpoint = new URL("/api/workflow/worker", process.env.WEB_SERVICE_URL || "http://web:3000");
const secret = process.env.SERVICE_TOKEN_SECRET || "";
if (Buffer.byteLength(secret) < 32) throw new Error("The company worker requires its service credential.");
const authorization = "Bearer " + createHmac("sha256", secret).update("company-sync-worker-v1").digest("hex");
const shutdown = new AbortController();
const configuredInterval = Number(process.env.WORKFLOW_POLL_INTERVAL_MS || 300000);
if (!Number.isInteger(configuredInterval) || configuredInterval < 10000 || configuredInterval > 300000) {
  throw new Error("WORKFLOW_POLL_INTERVAL_MS must be an integer from 10000 to 300000.");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown.abort());
console.log(JSON.stringify({ event: "workflow_worker_started", pollIntervalMs: configuredInterval }));
while (!shutdown.signal.aborted) {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { authorization }, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(240000)]) });
    const result = response.ok ? await response.json() : {};
    console.log(JSON.stringify({ event: "workflow_worker_tick", status: response.status, completed: result.completed || 0, failed: result.failed || 0, imported: result.imported || 0, analyzed: result.requestsAnalyzed || 0, pending: result.pendingAnalyses || 0 }));
  } catch {
    if (!shutdown.signal.aborted) console.log(JSON.stringify({ event: "workflow_worker_unavailable" }));
  }
  await setTimeout(configuredInterval, undefined, { signal: shutdown.signal }).catch(() => undefined);
}
