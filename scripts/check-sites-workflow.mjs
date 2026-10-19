import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

// Every identity, source and outcome below is fictional and confined to local D1/R2.
const root = process.cwd();
const directory = path.join(tmpdir(), "estimator-sites-qa-" + randomUUID());
mkdirSync(directory, { recursive: true });
const companyId = randomUUID();
let requestId;
do { requestId = randomUUID(); } while (createHash("sha256").update("the-estimator-delivery-holdout-v1:" + requestId).digest()[0] % 5 !== 0);
const taskId = randomUUID(), sourceId = randomUUID(), at = new Date().toISOString();
const config = { version: 1, fields: [{ key: "requester", label: "Requester", requestTypes: ["migration"], required: true }], products: [], capabilities: [], tasks: [{ id: "implementation", label: "Migration", baseHours: 10, lowFactor: 0.8, highFactor: 1.4 }] };
const knowledge = [{ id: sourceId, title: "FICTIONAL approved guide", text: "Fictional portal supports a one-time contact import after approved field mapping.", url: "", status: "approved", sha256: "f".repeat(64), addedAt: at, approvedAt: at, approvedBy: "Fixture administrator" }];
const review = { requestType: "migration", productId: "", deliverables: "One-time contact migration", exclusions: "Continuous synchronization", acceptance: "Reconciled record counts", dependencies: "Customer supplies export", questions: [], workPackages: [{ id: taskId, taskId: "implementation", title: "One-time contact migration", quantity: 1, complexity: "medium", owner: "company", acceptance: "Counts match", dependencies: "CSV ready" }], confirmed: false, confirmedBy: "", domain: "migration", fieldAnswers: {} };
const fixture = { id: requestId, title: "FICTIONAL runtime evaluation fixture", text: "Synthetic request, never recorded delivery evidence.", channel: "manual", cohort: "synthetic", createdBy: "qa-owner", createdAt: at, updatedAt: at, status: "needs_review", version: 1, attachments: [], analysis: { summary: "Synthetic analysis fixture; no model claim", requestType: "migration", productId: "", facts: [], capabilityFindings: [], productFindings: [], assumptions: [], conflicts: [], questions: [], deliverables: review.deliverables, exclusions: review.exclusions, acceptance: review.acceptance, dependencies: review.dependencies, workPackages: review.workPackages, sourceCheck: "Fictional fixture", run: { model: "fixture", elapsedMs: 0, steps: [] } }, review, baselines: [], delivery: [] };
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function tinyPdf(text) {
  const content = `BT /F1 12 Tf 20 80 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}
const migrations = readdirSync("drizzle").filter(name => /^\d+.*\.sql$/.test(name)).sort().map(name => readFileSync(path.join("drizzle", name), "utf8")).join("\n");
const sql = migrations + `\nINSERT INTO workflow_companies VALUES (${[companyId, "qa-owner", "FICTIONAL QA organization", 1, JSON.stringify({ config, knowledge }), at, at].map(quote).join(",")});\nINSERT INTO workflow_requests VALUES (${[requestId, "qa-owner", companyId, fixture.title, fixture.status, 1, JSON.stringify(fixture), at, at].map(quote).join(",")});\n`;
const sqlPath = path.join(directory, "seed.sql"); writeFileSync(sqlPath, sql);
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const cli = ["--import", pathToFileURL(path.join(root, "scripts", "sites-env.mjs")).href, wrangler];
const configuration = path.join(root, "dist", "server", "wrangler.json");
const seeded = spawnSync(process.execPath, [...cli, "d1", "execute", "DB", "--config", configuration, "--local", "--persist-to", directory, "--file", sqlPath], { cwd: root, encoding: "utf8" });
assert.equal(seeded.status, 0, seeded.stderr + seeded.stdout);
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`, url = origin + "/api/company-workspace";
// Public, disposable test key. Never reused by a hosted environment.
const worker = spawn(process.execPath, [...cli, "dev", "--config", configuration, "--local", "--persist-to", directory, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--var", "WORKFLOW_ENCRYPTION_KEY:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; worker.stdout.on("data", bytes => { logs += bytes; }); worker.stderr.on("data", bytes => { logs += bytes; });
const headers = actor => ({ "content-type": "application/json", origin, "oai-authenticated-user-id": actor, "oai-authenticated-user-email": `${actor}@example.invalid` });
async function action(body, actor = "qa-owner", status = 200) {
  const response = await fetch(url, { method: "POST", headers: headers(actor), body: JSON.stringify({ companyId, ...body }) });
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
}
async function workspace(actor = "qa-owner") { const response = await fetch(url + "?company=" + companyId, { headers: headers(actor), signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200); return response.json(); }
async function mcp(body, credential, scope = companyId, status = 200) {
  const response = await fetch(origin + "/mcp?company=" + scope, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(credential ? { authorization: "Bearer " + credential } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }) });
  assert.equal(response.status, status, await response.clone().text()); return response.json();
}
try {
  for (let attempt = 0; attempt < 300; attempt++) { if (worker.exitCode != null) throw new Error(logs); try { if ((await fetch(url)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal((await fetch(url)).status, 401);
  for (let attempt = 0; attempt < 3; attempt++) {
    const rejected = await fetch(url, { method: "POST", headers: { ...headers("qa-owner"), origin: "https://other.invalid" }, body: "{}", signal: AbortSignal.timeout(15000) });
    assert.equal(rejected.status, 403); await rejected.text();
    assert.equal((await workspace("qa-stranger")).company, undefined);
  }
  assert.equal((await workspace("qa-stranger")).company, undefined);
  for (const [userId, role] of [["qa-reviewer", "reviewer"], ["qa-viewer", "viewer"], ["qa-estimator", "estimator"]]) await action({ action: "setMember", userId, displayName: userId, role });
  await action({ action: "saveConfiguration", expectedVersion: 1, config }, "qa-viewer", 403);
  await action({ action: "createRequest", title: "Forbidden viewer request", text: "FICTIONAL request that a viewer cannot create.", cohort: "synthetic" }, "qa-viewer", 403);
  await action({ action: "setMember", userId: "qa-other", displayName: "Other", role: "admin" }, "qa-estimator", 403);
  const discovery = await mcp({ method: "tools/list" }); assert.equal(discovery.result.tools.length, 4); assert.ok(!JSON.stringify(discovery).includes("FICTIONAL approved guide"));
  async function rootMcp(name, args = {}, actor = "qa-owner", status = 200) {
    const response = await fetch(origin + "/mcp", { method: "POST", headers: { ...headers(actor), accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  }
  const listed = await rootMcp("company_list"); assert.ok(listed.result.content[0].text.includes(companyId));
  const rootSearch = await rootMcp("knowledge_search", { companyId, query: "contact" }); assert.ok(rootSearch.result.content[0].text.includes(sourceId));
  await rootMcp("knowledge_search", { companyId, query: "contact" }, "qa-stranger", 403);
  await rootMcp("knowledge_search", { query: "contact" }, "qa-owner", 400);
  await mcp({ method: "tools/call", params: { name: "knowledge_search", arguments: { query: "contact" } } }, undefined, companyId, 401);
  const token = (await action({ action: "rotateCredential", kind: "mcp" })).issuedCredential.value;
  const search = await mcp({ method: "tools/call", params: { name: "knowledge_search", arguments: { query: "contact" } } }, token);
  assert.ok(search.result.content[0].text.includes(sourceId));
  await mcp({ method: "tools/call", params: { name: "knowledge_fetch", arguments: { sourceId } } }, token, randomUUID(), 401);
  await action({ action: "revokeCredential", kind: "mcp" });
  await mcp({ method: "tools/call", params: { name: "knowledge_fetch", arguments: { sourceId } } }, token, companyId, 401);
  let current = (await workspace()).company.requests.find(row => row.id === requestId);
  await action({ action: "confirmScope", requestId, expectedVersion: current.version, confirmed: true }, "qa-owner", 400);
  let result = await action({ action: "saveReview", requestId, expectedVersion: current.version, review: { ...current.review, fieldAnswers: { requester: "Fictional company" } } });
  current = result.company.requests.find(row => row.id === requestId);
  result = await action({ action: "confirmScope", requestId, expectedVersion: current.version, confirmed: true }); current = result.company.requests.find(row => row.id === requestId);
  result = await action({ action: "estimate", requestId, expectedVersion: current.version }); current = result.company.requests.find(row => row.id === requestId); assert.equal(current.estimate.baseHours, 10);
  result = await action({ action: "freeze", requestId, expectedVersion: current.version }); current = result.company.requests.find(row => row.id === requestId); assert.equal(current.baselines[0].evaluation.split, "holdout");
  await action({ action: "deleteRequest", requestId, expectedVersion: current.version }, "qa-owner", 400);
  await action({ action: "saveReview", requestId, expectedVersion: current.version, review: current.review }, "qa-owner", 400);
  const submission = { action: "submitDelivery", requestId, expectedVersion: current.version, actualHours: { [taskId]: 12 }, addedScopeHours: 100, evidence: "FICTIONAL time records and original scope reconciliation for this QA fixture only.", deliveredAt: new Date().toISOString(), originalScopeOnly: true, reviewerId: "qa-owner" };
  await action(submission, "qa-owner", 400);
  await action({ ...submission, reviewerId: "qa-reviewer", actualHours: {} }, "qa-owner", 400);
  result = await action({ ...submission, reviewerId: "qa-reviewer" }); current = result.company.requests.find(row => row.id === requestId);
  const decision = { action: "reviewDelivery", requestId, expectedVersion: current.version, outcomeId: current.delivery[0].id, decision: "approved", evidenceInspected: true, notes: "Independently reviewed the fictional time records against the frozen scope." };
  await action(decision, "qa-owner", 403); await action(decision, "qa-viewer", 403);
  result = await action(decision, "qa-reviewer");
  assert.equal(result.company.evaluation.synthetic.n, 1); assert.equal(result.company.evaluation.synthetic.baseMAEHours, 2); assert.equal(result.company.evaluation.recorded.n, 0);
  await action(decision, "qa-reviewer", 409);
  const exported = await fetch(url + "?company=" + companyId + "&view=export", { headers: headers("qa-owner") }).then(response => response.text());
  const exportPath = path.join(directory, "synthetic-records.jsonl"); writeFileSync(exportPath, exported);
  const python = process.platform === "win32" ? "python" : "python3";
  const evaluated = spawnSync(python, ["evaluation/evaluate_delivery_holdout.py", "--records", exportPath], { cwd: root, encoding: "utf8" });
  assert.equal(evaluated.status, 0, evaluated.stderr); const report = JSON.parse(evaluated.stdout); assert.equal(report.holdout.synthetic.count, 1); assert.equal(report.holdout.recorded, undefined);
  const webhook = (await action({ action: "rotateCredential", kind: "webhook" })).issuedCredential.value;
  const inboundUrl = origin + "/api/company-workspace/inbound/" + companyId;
  const payload = { submissionId: "fictional-event-1", title: "FICTIONAL signed form", text: "Synthetic contact migration request. No real client or outcome is represented.", cohort: "synthetic", attachments: [{ name: "fictional.csv", contentBase64: Buffer.from("field,target\nEmail,email").toString("base64") }, { name: "fictional.pdf", contentBase64: tinyPdf("FICTIONAL PDF source page.") }] };
  async function send(input, signatureKey = webhook, expected = 201, timestamp = new Date().toISOString()) {
    const body = JSON.stringify(input), signature = createHmac("sha256", signatureKey).update(timestamp + "." + body).digest("hex");
    const response = await fetch(inboundUrl, { method: "POST", headers: { connection: "close", "content-type": "application/json", "x-workflow-timestamp": timestamp, "x-workflow-signature": signature }, body }); const text = await response.text(); assert.equal(response.status, expected, text); return JSON.parse(text);
  }
  const received = await send(payload); const replay = await send(payload, webhook, 200); assert.equal(replay.requestId, received.requestId); assert.equal(replay.duplicate, true); assert.equal(replay.retriedAnalysis, true);
  await send(payload, "invalid-secret", 401); await send(payload, webhook, 401, "2020-01-01T00:00:00.000Z");
  await send({ ...payload, text: payload.text + " Changed." }, webhook, 409);
  const inbound = (await workspace()).company.requests.find(row => row.id === received.requestId); assert.equal(inbound.channel, "webhook"); assert.equal(inbound.attachments[0].status, "extracted"); assert.equal(inbound.attachments[1].status, "extracted"); assert.ok(inbound.attachments[1].text.includes("FICTIONAL PDF source page.")); assert.deepEqual(inbound.attachments[1].locators, ["Page 1"]); assert.equal(inbound.status, "analysis_failed");
  const download = `${url}?company=${companyId}&request=${inbound.id}&file=${inbound.attachments[0].id}`;
  assert.equal((await fetch(download)).status, 401); assert.equal((await fetch(download, { headers: headers("qa-stranger") })).status, 404); assert.equal((await fetch(download, { headers: headers("qa-reviewer") })).status, 200);
  await action({ action: "revokeCredential", kind: "webhook" }); await send(payload, webhook, 401);
  assert.ok((await workspace()).company.audit.some(event => event.action === "delivery.approved"));
  console.log("PASS: roles, tenant/file isolation, CSRF, MCP discovery/scoping/revocation, scope gate, frozen baseline, task actuals, self-review rejection, independent approval, compatible holdout export, signed webhook replay/revocation.");
} catch (error) { await new Promise(resolve => setTimeout(resolve, 1000)); console.error(error); console.error(logs.split("\n").filter(line => !/[│├└┌─]/.test(line)).slice(-90).join("\n")); process.exitCode = 1; }
finally { worker.kill("SIGTERM"); await new Promise(resolve => { worker.once("exit", resolve); setTimeout(resolve, 3000).unref(); }); }
