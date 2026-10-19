import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("worker starts an authenticated background cycle without an open browser", { timeout: 10000 }, async t => {
  const secret = "synthetic-worker-test-credential-0123456789";
  const expected = "Bearer " + createHmac("sha256", secret).update("company-sync-worker-v1").digest("hex");
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/workflow/worker");
    assert.equal(request.headers.authorization, expected);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ completed: 2, failed: 0, imported: 1, requestsAnalyzed: 1, pendingAnalyses: 0 }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../services/workflow-worker/worker.mjs", import.meta.url))], {
    env: { ...process.env, SERVICE_TOKEN_SECRET: secret, WEB_SERVICE_URL: "http://127.0.0.1:" + server.address().port, WORKFLOW_POLL_INTERVAL_MS: "10000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); server.close(); });
  let stdout = "", stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No background cycle completed: " + stderr)), 7000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes('"event":"workflow_worker_tick"')) { clearTimeout(timer); resolve(); }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
  const logs = stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(requests, 1);
  assert.equal(logs[0].pollIntervalMs, 10000);
  const tick = logs.find(item => item.event === "workflow_worker_tick");
  assert.equal(tick.imported, 1);
  assert.equal(tick.analyzed, 1);
  assert.equal(stdout.includes(secret), false);
});
