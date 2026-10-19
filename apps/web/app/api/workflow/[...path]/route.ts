import { createHash, createHmac, randomUUID } from "node:crypto";
import { sameOriginRequest } from "../../../../lib/identity";
import { beginGmail, companyContext, disconnectGmail, finishGmail, syncGmail } from "../../../../lib/gmail-workflow";
import { handleKnowledgeMCP } from "../../../../lib/knowledge-mcp";
import { analyzeCompanyRequest, briefWorkflow, companyAction, equalSecret, extractAttachments, readWorkflowBody, workerAuthorization, workflowActor, workflowData, WorkflowError, workflowJSON, workflowResponse } from "../../../../lib/workflow-service";
import type { Company } from "../../../../lib/workflow-types";
import { runWorkflowCycle, type WorkflowJobs } from "../../../../lib/workflow-cycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const browserActions = ["config", "member", "removeMember", "knowledge.add", "knowledge.approve", "knowledge.retire", "knowledge.token.rotate", "knowledge.token.revoke", "review", "estimate", "freeze", "delivery", "delivery.review", "delivery.revise", "request.delete", "request.update", "analysis.retry", "gmail.configure", "webhook.rotate"];
async function parseJSON(request: Request) {
  try { return JSON.parse(new TextDecoder().decode(await readWorkflowBody(request))) as Record<string, unknown>; }
  catch (error) { if (error instanceof WorkflowError) throw error; throw new WorkflowError("Use a valid JSON request."); }
}
async function inbound(request: Request, companyId: string) {
  const raw = await readWorkflowBody(request, 30 * 1024 * 1024);
  const context = await companyContext(companyId);
  const timestamp = request.headers.get("x-workflow-timestamp") ?? "";
  const signature = request.headers.get("x-workflow-signature") ?? "";
  const date = Date.parse(timestamp);
  const expected = createHmac("sha256", context.webhookSecret || "").update(timestamp + ".").update(raw).digest("hex");
  if (!context.webhookSecret || !Number.isFinite(date) || Math.abs(Date.now() - date) > 300000 || !equalSecret(signature, expected)) throw new WorkflowError("Invalid or expired form signature.", 401);
  const input = JSON.parse(new TextDecoder().decode(raw)) as { submissionId: string; title: string; text: string; attachments?: { name: string; contentBase64: string; contentType?: string }[] };
  if (!input.submissionId || input.submissionId.length > 500 || (input.attachments?.length ?? 0) > 10) throw new WorkflowError("A stable submission ID and up to 10 attachments are required.");
  const files = (input.attachments ?? []).map(file => new File([Buffer.from(file.contentBase64, "base64")], file.name, { type: file.contentType }));
  const result = await companyAction(companyId, { action: "intake", channel: "form", externalId: input.submissionId, sourceIds: [input.submissionId, createHash("sha256").update(raw).digest("hex")], title: input.title, text: input.text, attachments: await extractAttachments(files) }, context.webhookActor);
  return workflowJSON({ requestId: result.objectId, status: result.company.requests.find(item => item.id === result.objectId)?.status }, 202);
}
async function worker(request: Request) {
  if (!equalSecret(request.headers.get("authorization") ?? "", "Bearer " + workerAuthorization())) throw new WorkflowError("Worker authorization required.", 401);
  const actor = "00000000-0000-4000-8000-000000000001";
  return workflowJSON(await runWorkflowCycle({
    loadJobs: () => workflowData<WorkflowJobs>("jobs", "GET", undefined, actor, "workflow:worker"),
    syncMailbox: syncGmail,
    analyzeRequest: (companyId, requestId, accountId) => analyzeCompanyRequest(companyId, requestId, accountId, true),
  }));
}
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await params).path;
    if (request.method === "POST" && path.join("/") === "worker") return await worker(request);
    if (request.method === "POST" && path.length === 2 && path[0] === "inbound" && uuid.test(path[1])) return await inbound(request, path[1]);
    if (path[0] === "companies" && uuid.test(path[1] ?? "") && path[2] === "mcp" && path.length === 3) return await handleKnowledgeMCP(request, path[1]);
    const actor = await workflowActor();
    if (request.method === "GET" && path.join("/") === "gmail/callback") return await finishGmail(actor, request);
    if (request.method !== "GET" && (!sameOriginRequest(request) || request.headers.get("sec-fetch-site") === "cross-site")) throw new WorkflowError("This workspace request could not be verified.", 403);
    if (path.length === 1 && path[0] === "companies") {
      if (request.method === "GET") return workflowJSON(await workflowData("companies", "GET", undefined, actor));
      if (request.method === "POST") return workflowJSON(await workflowData("companies", "POST", await parseJSON(request), actor), 201);
    }
    const companyId = path[1];
    if (path[0] !== "companies" || !uuid.test(companyId ?? "")) throw new WorkflowError("Company endpoint not found.", 404);
    if (request.method === "GET") {
      if (path.length === 2) return workflowJSON(await workflowData("companies/" + companyId, "GET", undefined, actor));
      if (path.length===4 && path[2]==="attachments" && uuid.test(path[3])) {
        const response=await workflowResponse(`companies/${companyId}/attachments/${path[3]}`,"GET",undefined,actor);
        return new Response(response.body,{status:response.status,headers:{"cache-control":"no-store","content-type":response.headers.get("content-type")||"application/octet-stream","content-disposition":"attachment","x-content-type-options":"nosniff"}});
      }
      if (path.length === 4 && path[2] === "gmail" && path[3] === "connect") return await beginGmail(companyId, actor, request);
      if (path.length === 3 && path[2] === "webhook-secret") {
        const context = await workflowData<{ webhookSecret: string }>(`companies/${companyId}/connector-secret`, "GET", undefined, actor, "workflow:connector");
        return workflowJSON({ secret: context.webhookSecret, endpoint: new URL("/api/workflow/inbound/" + companyId, request.url).toString() });
      }
      if (path.length === 3 && ["knowledge", "evaluation", "export", "schema"].includes(path[2])) {
        const response = await workflowResponse(`companies/${companyId}/${path[2]}${new URL(request.url).search}`, "GET", undefined, actor);
        return new Response(response.body, { status: response.status, headers: { "cache-control": "no-store", "content-type": response.headers.get("content-type") ?? "application/json", ...(response.headers.has("content-disposition") ? { "content-disposition": response.headers.get("content-disposition")! } : {}) } });
      }
    }
    if (request.method === "DELETE" && path.length === 2) {
      await disconnectGmail(companyId, actor);
      const result = await workflowResponse("companies/" + companyId, "DELETE", undefined, actor);
      return new Response(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST") {
      if (path.length === 3 && path[2] === "actions") {
        const input = await parseJSON(request);
        if (!browserActions.includes(String(input.action))) throw new WorkflowError("Unsupported workspace action.");
        return workflowJSON(await companyAction(companyId, input, actor));
      }
      const company = await workflowData<Company>("companies/" + companyId, "GET", undefined, actor);
      if (path.length === 3 && path[2] === "intake") {
        const bytes = await readWorkflowBody(request, 22 * 1024 * 1024);
        const form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: bytes.buffer as ArrayBuffer }).formData();
        const title = String(form.get("title") ?? ""), text = String(form.get("text") ?? "");
        const files = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
        const result = await companyAction(companyId, { action: "intake", channel: "manual", externalId: randomUUID(), sourceIds: [], title, text, attachments: await extractAttachments(files) }, actor);
        return workflowJSON(result, 201);
      }
      if (path.length === 4 && path[2] === "analyze" && uuid.test(path[3])) return workflowJSON(await analyzeCompanyRequest(companyId, path[3], actor));
      if (company.role !== "admin") throw new WorkflowError("A company administrator is required.", 403);
      if (path.length === 4 && path[2] === "knowledge" && path[3] === "fetch") {
        const input = await parseJSON(request);
        const source = await briefWorkflow<{ url: string; text: string }>("fetch", { url: String(input.url), approvedDomains: company.config.approvedDomains });
        return workflowJSON(await companyAction(companyId, { action: "knowledge.add", document: { title: input.title || new URL(source.url).hostname, url: source.url, text: source.text, replacesId: input.replacesId || "" } }, actor));
      }
      if (path.length === 4 && path[2] === "knowledge" && path[3] === "upload") {
        const bytes = await readWorkflowBody(request, 11 * 1024 * 1024);
        const form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: bytes.buffer as ArrayBuffer }).formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new WorkflowError("Choose a knowledge document.");
        const [document] = await extractAttachments([file]);
        if (document.status !== "extracted") throw new WorkflowError(document.error || "Document extraction failed.");
        if (document.truncated) throw new WorkflowError("The knowledge document exceeds the extraction limit. Upload a reviewed excerpt so the approved source is complete.");
        return workflowJSON(await companyAction(companyId, { action: "knowledge.add", document: { title: String(form.get("title") || file.name), url: "", text: document.text } }, actor));
      }
      if (path.length === 4 && path[2] === "gmail" && path[3] === "sync") return workflowJSON(await syncGmail(companyId, actor));
      if (path.length === 4 && path[2] === "gmail" && path[3] === "disconnect") return workflowJSON(await disconnectGmail(companyId, actor));
    }
    throw new WorkflowError("Company endpoint not found.", 404);
  } catch (error) {
    return workflowJSON({ error: error instanceof WorkflowError ? error.message : "The company operation could not be completed. Retry or check service configuration." }, error instanceof WorkflowError ? error.status : 503);
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
