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
const cappedCompanyId = randomUUID();
let requestId;
do { requestId = randomUUID(); } while (createHash("sha256").update("the-estimator-delivery-holdout-v1:" + requestId).digest()[0] % 5 !== 0);
const taskId = randomUUID(), sourceId = randomUUID(), at = new Date().toISOString();
const config = { version: 1, fields: [{ key: "requester", label: "Requester", requestTypes: ["migration"], required: true }], products: [], capabilities: [], tasks: [{ id: "implementation", label: "Migration", baseHours: 10, lowFactor: 0.8, highFactor: 1.4 }] };
const knowledge = [{ id: sourceId, title: "FICTIONAL approved guide", text: "Fictional portal supports a one-time contact import after approved field mapping.", url: "", status: "approved", sha256: "f".repeat(64), addedAt: at, approvedAt: at, approvedBy: "Fixture administrator" }];
const review = { requestType: "migration", productId: "", deliverables: "One-time contact migration", exclusions: "Continuous synchronization", acceptance: "Reconciled record counts", dependencies: "Customer supplies export", questions: [], workPackages: [{ id: taskId, taskId: "implementation", title: "One-time contact migration", quantity: 1, complexity: "medium", owner: "company", acceptance: "Counts match", dependencies: "CSV ready" }], confirmed: false, confirmedBy: "", domain: "migration", fieldAnswers: {} };
const fixture = { id: requestId, title: "FICTIONAL runtime evaluation fixture", text: "Synthetic request, never recorded delivery evidence.", channel: "manual", cohort: "synthetic", createdBy: "qa-owner", createdAt: at, updatedAt: at, status: "needs_review", version: 1, attachments: [], analysis: { summary: "Synthetic analysis fixture; no model claim", requestType: "migration", productId: "", facts: [], capabilityFindings: [], productFindings: [], assumptions: [], conflicts: [], questions: [], deliverables: review.deliverables, exclusions: review.exclusions, acceptance: review.acceptance, dependencies: review.dependencies, workPackages: review.workPackages, sourceCheck: "Fictional fixture", run: { model: "fixture", elapsedMs: 0, steps: [] } }, review, baselines: [], delivery: [] };
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const snapshotFillers = Array.from({ length: 30 }, (_, index) => ({ ...fixture, id: randomUUID(), title: `FICTIONAL snapshot paging fixture ${index + 1}`, status: "received", analysis: undefined, delivery: [], baselines: [] }));
const activeSnapshotIds = Array.from({ length: 3 }, () => randomUUID());
const capExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
function tinyPdf(text) {
  const content = `BT /F1 12 Tf 20 80 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}
const migrations = readdirSync("drizzle").filter(name => /^\d+.*\.sql$/.test(name)).sort().map(name => readFileSync(path.join("drizzle", name), "utf8")).join("\n");
const seedRequests = [fixture, ...snapshotFillers].map(record => `INSERT INTO workflow_requests VALUES (${[record.id, "qa-owner", companyId, record.title, record.status, record.version, JSON.stringify(record), at, at].map(quote).join(",")});`).join("\n");
const capSnapshots = activeSnapshotIds.map(id => `INSERT INTO workflow_export_snapshots VALUES (${[id, cappedCompanyId, at, capExpiresAt].map(quote).join(",")});`).join("\n");
const sql = migrations + `\nINSERT INTO workflow_companies VALUES (${[companyId, "qa-owner", "FICTIONAL QA organization", 1, JSON.stringify({ config, knowledge }), at, at].map(quote).join(",")});\nINSERT INTO workflow_companies VALUES (${[cappedCompanyId, "qa-owner", "FICTIONAL snapshot cap QA", 1, JSON.stringify({ config, knowledge: [] }), at, at].map(quote).join(",")});\n${seedRequests}\n${capSnapshots}\n`;
const sqlPath = path.join(directory, "seed.sql"); writeFileSync(sqlPath, sql);
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const cli = ["--import", pathToFileURL(path.join(root, "scripts", "sites-env.mjs")).href, wrangler];
const builtConfiguration = path.join(root, "dist", "server", "wrangler.json");
const builtConfig = JSON.parse(readFileSync(builtConfiguration, "utf8"));
assert.deepEqual(builtConfig.triggers?.crons, ["*/5 * * * *"]);
// The Sites build marks its standalone output no_bundle; Wrangler then skips
// its local scheduled-test middleware. A local QA config enables that wrapper
// while keeping the same Worker, bindings, D1/R2 persistence, and cron config.
const runtimeConfig = { ...builtConfig };
delete runtimeConfig.no_bundle;
delete runtimeConfig.build;
const configuration = path.join(root, "dist", "server", "wrangler-runtime-qa.json");
writeFileSync(configuration, JSON.stringify(runtimeConfig));
function executeSql(command) {
  const executed = spawnSync(process.execPath, [...cli, "d1", "execute", "DB", "--config", configuration, "--local", "--persist-to", directory, "--command", command, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr + executed.stdout);
  return JSON.parse(executed.stdout);
}
const seeded = spawnSync(process.execPath, [...cli, "d1", "execute", "DB", "--config", configuration, "--local", "--persist-to", directory, "--file", sqlPath], { cwd: root, encoding: "utf8" });
assert.equal(seeded.status, 0, seeded.stderr + seeded.stdout);
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`, url = origin + "/api/company-workspace";
// Public, disposable test key. Never reused by a hosted environment.
let logs = "";
let uploadedRequestId = "";
let uploadedFileId = "";
let uploadedObjectKey = "";
function launchWorker(workerPort, publicAccess) {
  const child = spawn(process.execPath, [...cli, "dev", "--config", configuration, "--local", "--test-scheduled", "--persist-to", directory, "--ip", "127.0.0.1", "--port", String(workerPort), "--inspector-port", "0", "--var", "WORKFLOW_ENCRYPTION_KEY:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "--var", `PUBLIC_DEMO_ACCESS:${publicAccess}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", bytes => { logs += bytes; }); child.stderr.on("data", bytes => { logs += bytes; });
  return child;
}
let worker = launchWorker(port, "true");
const headers = actor => ({ "content-type": "application/json", origin, "oai-authenticated-user-id": actor, "oai-authenticated-user-email": `${actor}@example.invalid` });
async function action(body, actor = "qa-owner", status = 200) {
  const response = await fetch(url, { method: "POST", headers: headers(actor), body: JSON.stringify({ companyId, ...body }) });
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
}
async function workspace(actor = "qa-owner", status = 200) { const response = await fetch(url + "?company=" + companyId, { headers: headers(actor), signal: AbortSignal.timeout(15000) }); assert.equal(response.status, status); return response.json(); }
async function mcp(body, credential, scope = companyId, status = 200) {
  const response = await fetch(origin + "/mcp?company=" + scope, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(credential ? { authorization: "Bearer " + credential } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }) });
  assert.equal(response.status, status, await response.clone().text()); return response.json();
}
try {
  let publicWorkspaceResponse;
  for (let attempt = 0; attempt < 300; attempt++) { if (worker.exitCode != null) throw new Error(logs); try { publicWorkspaceResponse = await fetch(url); if (publicWorkspaceResponse.status === 200) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(publicWorkspaceResponse?.status, 200);
  const publicWorkspace = await publicWorkspaceResponse.json();
  assert.equal(publicWorkspace.actorId, "public-demo:shared");
  assert.deepEqual(publicWorkspace.companies, []);
  const publicCannotReadFixture = await fetch(url + "?company=" + companyId);
  assert.equal(publicCannotReadFixture.status, 404);
  assert.equal((await publicCannotReadFixture.json()).company, undefined);
  assert.equal((await fetch(origin + "/api/workspace")).status, 401);
  const publicCompanyResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "createCompany", name: "FICTIONAL public demo QA" }) });
  const publicCompanyWorkspace = await publicCompanyResponse.json();
  assert.equal(publicCompanyResponse.status, 200, JSON.stringify(publicCompanyWorkspace));
  assert.equal(publicCompanyWorkspace.actorId, "public-demo:shared");
  assert.equal(publicCompanyWorkspace.company.role, "admin");
  const publicCompanyId = publicCompanyWorkspace.company.id;
  const publicMemberId = "qa-public-member";
  const publicMemberResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "setMember", companyId: publicCompanyId, userId: publicMemberId, displayName: "Fictional QA member", role: "estimator" }) });
  assert.equal(publicMemberResponse.status, 200, await publicMemberResponse.clone().text()); await publicMemberResponse.text();
  const publicMcpCredentialResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "rotateCredential", companyId: publicCompanyId, kind: "mcp" }) });
  assert.equal(publicMcpCredentialResponse.status, 200);
  const publicMcpToken = (await publicMcpCredentialResponse.json()).issuedCredential.value;
  const publicMcpCall = await fetch(origin + "/mcp?company=" + publicCompanyId, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + publicMcpToken }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "company_list", arguments: { companyId: publicCompanyId } } }) });
  assert.equal(publicMcpCall.status, 200, await publicMcpCall.clone().text());
  assert.ok((await publicMcpCall.json()).result.content[0].text.includes(publicCompanyId));
  const publicRevokeMcp = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "revokeCredential", companyId: publicCompanyId, kind: "mcp" }) });
  assert.equal(publicRevokeMcp.status, 200); await publicRevokeMcp.text();
  const publicRevokedMcpCall = await fetch(origin + "/mcp?company=" + publicCompanyId, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + publicMcpToken }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "company_list", arguments: { companyId: publicCompanyId } } }) });
  assert.equal(publicRevokedMcpCall.status, 401); await publicRevokedMcpCall.text();
  const publicRequestResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "createRequest", companyId: publicCompanyId, title: "FICTIONAL public demo cohort check", text: "A fictional sample request used only to verify public demo cohort protection.", cohort: "recorded" }) });
  assert.equal(publicRequestResponse.status, 200);
  const publicRequestWorkspace = await publicRequestResponse.json();
  assert.equal(publicRequestWorkspace.company.requests.find(item => item.title === "FICTIONAL public demo cohort check").cohort, "synthetic");
  const signedMemberRequest = await fetch(url, { method: "POST", headers: headers(publicMemberId), body: JSON.stringify({ action: "createRequest", companyId: publicCompanyId, title: "FICTIONAL signed member cohort check", text: "A fictional request verifies that a signed-in demo member cannot mark public data recorded.", cohort: "recorded" }) });
  assert.equal(signedMemberRequest.status, 200, await signedMemberRequest.clone().text());
  assert.equal((await signedMemberRequest.json()).company.requests.find(item => item.title === "FICTIONAL signed member cohort check").cohort, "synthetic");
  const publicWebhookResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "rotateCredential", companyId: publicCompanyId, kind: "webhook" }) });
  assert.equal(publicWebhookResponse.status, 200);
  const publicWebhookSecret = (await publicWebhookResponse.json()).issuedCredential.value;
  const publicPayload = { submissionId: "fictional-public-webhook", title: "FICTIONAL public webhook cohort check", text: "A fictional signed request used only to verify public webhook cohort protection.", cohort: "recorded", attachments: [] };
  const publicTimestamp = new Date().toISOString(), publicBody = JSON.stringify(publicPayload);
  const publicSignature = createHmac("sha256", publicWebhookSecret).update(publicTimestamp + "." + publicBody).digest("hex");
  const publicInboundResponse = await fetch(origin + "/api/company-workspace/inbound/" + publicCompanyId, { method: "POST", headers: { "content-type": "application/json", "x-workflow-timestamp": publicTimestamp, "x-workflow-signature": publicSignature }, body: publicBody });
  assert.equal(publicInboundResponse.status, 201, await publicInboundResponse.clone().text());
  const publicInbound = await publicInboundResponse.json();
  const publicWorkspaceAfterInbound = await fetch(url + "?company=" + publicCompanyId).then(response => response.json());
  assert.equal(publicWorkspaceAfterInbound.company.requests.find(item => item.id === publicInbound.requestId).cohort, "synthetic");
  const publicRevokeWebhook = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "revokeCredential", companyId: publicCompanyId, kind: "webhook" }) });
  assert.equal(publicRevokeWebhook.status, 200); await publicRevokeWebhook.text();
  const revokedPublicWebhookCall = await fetch(origin + "/api/company-workspace/inbound/" + publicCompanyId, { method: "POST", headers: { "content-type": "application/json", "x-workflow-timestamp": publicTimestamp, "x-workflow-signature": publicSignature }, body: publicBody });
  assert.equal(revokedPublicWebhookCall.status, 401); await revokedPublicWebhookCall.text();
  const retainedPublicWebhook = (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ action: "rotateCredential", companyId: publicCompanyId, kind: "webhook" }) })).json()).issuedCredential.value;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rejected = await fetch(url, { method: "POST", headers: { ...headers("qa-owner"), origin: "https://other.invalid" }, body: "{}", signal: AbortSignal.timeout(15000) });
    assert.equal(rejected.status, 403); await rejected.text();
    assert.equal((await workspace("qa-stranger", 404)).company, undefined);
  }
  assert.equal((await workspace("qa-stranger", 404)).company, undefined);
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
  await rootMcp("knowledge_search", { companyId, query: "contact" }, "qa-stranger", 404);
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
  const frozenSha = current.baselines[0].sha256;
  const tracking = { action: "saveTracking", requestId, expectedVersion: current.version, taskTracking: [{ workPackageId: taskId, status: "in_progress", assignee: "qa-owner", plannedStart: "2026-10-20", plannedEnd: "2026-10-23", blocker: "", milestones: [{ id: randomUUID(), title: "FICTIONAL validation checkpoint", dueDate: "2026-10-22", status: "pending" }] }], scopeChange: { description: "FICTIONAL additional sync request", reason: "Added after approval for the runtime fixture", effortImpact: "Requires a separate estimate" } };
  await action({ ...tracking, taskTracking: [] }, "qa-owner", 400);
  await action({ ...tracking, taskTracking: tracking.taskTracking.map(item => ({ ...item, assignee: "qa-stranger" })) }, "qa-owner", 400);
  await action({ ...tracking, taskTracking: tracking.taskTracking.map(item => ({ ...item, plannedStart: "2026-02-30" })) }, "qa-owner", 400);
  result = await action(tracking); current = result.company.requests.find(row => row.id === requestId);
  assert.equal(current.baselines[0].sha256, frozenSha); assert.equal(current.taskTracking[0].status, "in_progress"); assert.equal(current.taskTracking[0].assignee, "qa-owner"); assert.equal(current.taskTracking[0].milestones[0].title, "FICTIONAL validation checkpoint"); assert.equal(current.scopeChanges[0].status, "proposed");
  await action({ action: "deleteRequest", requestId, expectedVersion: current.version }, "qa-owner", 400);
  await action({ action: "saveReview", requestId, expectedVersion: current.version, review: current.review }, "qa-owner", 400);
  const submission = { action: "submitDelivery", requestId, expectedVersion: current.version, actualHours: { [taskId]: 12 }, addedScopeHours: 100, evidence: "FICTIONAL time records and original scope reconciliation for this QA fixture only.", deliveredAt: new Date().toISOString(), originalScopeOnly: true, reviewerId: "qa-owner" };
  await action(submission, "qa-owner", 400);
  await action({ ...submission, reviewerId: "qa-reviewer", actualHours: {} }, "qa-owner", 400);
  result = await action({ ...submission, reviewerId: "qa-reviewer" }); current = result.company.requests.find(row => row.id === requestId);
  const approvalSnapshotResponse = await fetch(url + "?company=" + companyId + "&view=export", { headers: headers("qa-owner") });
  assert.equal(approvalSnapshotResponse.status, 200);
  const decision = { action: "reviewDelivery", requestId, expectedVersion: current.version, outcomeId: current.delivery[0].id, decision: "approved", evidenceInspected: true, notes: "Independently reviewed the fictional time records against the frozen scope." };
  await action(decision, "qa-owner", 403); await action(decision, "qa-viewer", 403);
  result = await action(decision, "qa-reviewer");
  const approvalSnapshot = (await approvalSnapshotResponse.text()).trim().split("\n").map(line => JSON.parse(line)).find(record => record.id === requestId);
  assert.equal(approvalSnapshot.payload.deliveryOutcome.status, "pending", "an in-flight export must retain the pending state captured before approval");
  assert.equal(result.company.evaluation.synthetic.n, 1); assert.equal(result.company.evaluation.synthetic.baseMAEHours, 2); assert.equal(result.company.evaluation.recorded.n, 0);
  await action(decision, "qa-reviewer", 409);
  const approvedExportResponse = await fetch(url + "?company=" + companyId + "&view=export", { headers: headers("qa-owner") });
  assert.equal(approvedExportResponse.status, 200);
  const exported = await approvedExportResponse.text();
  const exportedRecord = exported.trim().split("\n").map(line => JSON.parse(line)).find(record => record.id === requestId);
  assert.ok(exportedRecord);
  assert.equal(exportedRecord.payload.deliveryOutcome.originalHours, 12);
  const cappedExport = await fetch(url + "?company=" + cappedCompanyId + "&view=export", { headers: headers("qa-owner") });
  assert.equal(cappedExport.status, 429, await cappedExport.text());
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
  assert.equal((await fetch(download)).status, 404); assert.equal((await fetch(download, { headers: headers("qa-stranger") })).status, 404); assert.equal((await fetch(download, { headers: headers("qa-reviewer") })).status, 200);
  const uploadBytes = Buffer.from("email,name\nqa@example.invalid,Fictional QA");
  const uploadName = "fictional-runtime-upload.csv";
  const uploadHash = createHash("sha256").update(uploadBytes).digest("hex");
  const uploadForm = new FormData();
  uploadForm.append("payload", JSON.stringify({ action: "createRequest", companyId, title: "FICTIONAL R2 cleanup runtime check", text: "A fictional local request verifies attachment persistence and scheduled object cleanup.", attachments: [{ name: uploadName, type: "csv", size: uploadBytes.length, sha256: uploadHash, text: "[Row 1] email,name\n[Row 2] qa@example.invalid,Fictional QA", locators: ["Row 1", "Row 2"], truncated: false, status: "extracted" }] }));
  uploadForm.append("files", new Blob([uploadBytes], { type: "text/csv" }), uploadName);
  const uploadedResponse = await fetch(url, { method: "POST", headers: { origin, "oai-authenticated-user-id": "qa-owner", "oai-authenticated-user-email": "qa-owner@example.invalid" }, body: uploadForm });
  const uploadedWorkspace = await uploadedResponse.json(); assert.equal(uploadedResponse.status, 200, JSON.stringify(uploadedWorkspace));
  const uploaded = uploadedWorkspace.company.requests.find(row => row.title === "FICTIONAL R2 cleanup runtime check"); assert.ok(uploaded);
  uploadedRequestId = uploaded.id;
  uploadedFileId = uploaded.attachments[0].id;
  const uploadedFileUrl = `${url}?company=${companyId}&request=${uploaded.id}&file=${uploadedFileId}`;
  assert.equal((await fetch(uploadedFileUrl, { headers: headers("qa-owner") })).status, 200);
  uploadedObjectKey = "request-files/qa-owner/" + companyId + "/" + uploaded.id + "/" + uploadedFileId;
  await action({ action: "revokeCredential", kind: "webhook" }); await send(payload, webhook, 401);
  assert.ok((await workspace()).company.audit.some(event => event.action === "delivery.approved"));
  await new Promise(resolve => { const timeout = setTimeout(resolve, 3000); worker.once("exit", () => { clearTimeout(timeout); resolve(); }); worker.kill("SIGTERM"); });
  const orphanItems = executeSql("SELECT COUNT(*) AS n FROM workflow_export_snapshot_items AS item LEFT JOIN workflow_export_snapshots AS snapshot ON snapshot.id = item.snapshot_id WHERE snapshot.id IS NULL")[0].results[0].n;
  assert.equal(orphanItems, 0, "snapshot cap rejection and stream completion must leave no orphan rows");
  const queued = executeSql("INSERT INTO workflow_object_deletions(object_key, attempts, available_at, created_at) VALUES (" + [quote(uploadedObjectKey), "0", quote(new Date(Date.now() - 60_000).toISOString()), quote(new Date().toISOString())].join(",") + ")");
  assert.equal(queued[0].success, true);
  const disabledSocket = net.createServer(); await new Promise(resolve => disabledSocket.listen(0, "127.0.0.1", resolve)); const disabledPort = disabledSocket.address().port; await new Promise(resolve => disabledSocket.close(resolve));
  worker = launchWorker(disabledPort, "false");
  const disabledOrigin = `http://127.0.0.1:${disabledPort}`, disabledUrl = disabledOrigin + "/api/company-workspace", disabledInboundUrl = disabledOrigin + "/api/company-workspace/inbound/" + publicCompanyId;
  let memberWorkspaceResponse;
  for (let attempt = 0; attempt < 300; attempt++) { if (worker.exitCode != null) throw new Error(logs); try { memberWorkspaceResponse = await fetch(disabledUrl + "?company=" + publicCompanyId, { headers: { "oai-authenticated-user-id": publicMemberId, "oai-authenticated-user-email": `${publicMemberId}@example.invalid` } }); if (memberWorkspaceResponse.status === 200) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(memberWorkspaceResponse?.status, 200, await memberWorkspaceResponse?.clone().text());
  const scheduled = await fetch(disabledOrigin + "/__scheduled?cron=*%2F5+*+*+*+*"); assert.equal(scheduled.status, 200, await scheduled.text());
  const uploadedFileAfterCleanup = await fetch(disabledUrl + "?company=" + companyId + "&request=" + uploadedRequestId + "&file=" + uploadedFileId, { headers: { "oai-authenticated-user-id": "qa-owner", "oai-authenticated-user-email": "qa-owner@example.invalid" } });
  assert.equal(uploadedFileAfterCleanup.status, 404, "scheduled cleanup should remove the R2 object while retaining the request record");
  const qaWorkspace = await fetch(disabledUrl + "?company=" + companyId, { headers: { "oai-authenticated-user-id": "qa-owner", "oai-authenticated-user-email": "qa-owner@example.invalid" } }).then(response => response.json());
  const uploadedCurrent = qaWorkspace.company.requests.find(row => row.id === uploadedRequestId);
  const deleteUploaded = await fetch(disabledUrl, { method: "POST", headers: { "content-type": "application/json", origin: disabledOrigin, "oai-authenticated-user-id": "qa-owner", "oai-authenticated-user-email": "qa-owner@example.invalid" }, body: JSON.stringify({ action: "deleteRequest", companyId, requestId: uploadedRequestId, expectedVersion: uploadedCurrent.version }) });
  assert.equal(deleteUploaded.status, 200, await deleteUploaded.clone().text()); await deleteUploaded.text();
  const disabledPayload = { submissionId: "fictional-public-webhook-disabled-mode", title: "FICTIONAL webhook with public access disabled", text: "This fictional signed webhook checks the shared demo owner cohort when public access is disabled.", cohort: "recorded", attachments: [] };
  const disabledTimestamp = new Date().toISOString(), disabledBody = JSON.stringify(disabledPayload), disabledSignature = createHmac("sha256", retainedPublicWebhook).update(disabledTimestamp + "." + disabledBody).digest("hex");
  const disabledInboundResponse = await fetch(disabledInboundUrl, { method: "POST", headers: { "content-type": "application/json", "x-workflow-timestamp": disabledTimestamp, "x-workflow-signature": disabledSignature }, body: disabledBody });
  assert.equal(disabledInboundResponse.status, 201, await disabledInboundResponse.clone().text()); const disabledInbound = await disabledInboundResponse.json();
  const disabledWorkspace = await fetch(disabledUrl + "?company=" + publicCompanyId, { headers: { "oai-authenticated-user-id": publicMemberId, "oai-authenticated-user-email": `${publicMemberId}@example.invalid` } }).then(response => response.json());
  assert.equal(disabledWorkspace.company.requests.find(row => row.id === disabledInbound.requestId).cohort, "synthetic");
  console.log("PASS: roles, tenant/file isolation, CSRF, public demo synthetic cohorts for anonymous and signed-in members, disabled-mode signed webhook cohort enforcement, MCP discovery/scoping/revocation, scope gate, frozen baseline, task actuals, self-review rejection, independent approval, D1-consistent paginated exports, snapshot concurrency cap, private R2 upload, scheduled R2 deletion, signed webhook replay/revocation.");
} catch (error) { await new Promise(resolve => setTimeout(resolve, 1000)); console.error(error); console.error(logs.split("\n").filter(line => !/[│├└┌─]/.test(line)).slice(-90).join("\n")); process.exitCode = 1; }
finally { worker.kill("SIGTERM"); await new Promise(resolve => { worker.once("exit", resolve); setTimeout(resolve, 3000).unref(); }); }
