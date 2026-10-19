import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";
import { accountForSession } from "./identity";
import { configuredServiceUrl } from "./operations";
import { briefServiceAuthorization, type BriefServiceScope } from "./brief-service-auth";
import type { Analysis, Company, ScopeReview, Attachment } from "./workflow-types";

export class WorkflowError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function workflowJSON(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
export async function workflowActor() {
  const session = await accountForSession();
  if (!session?.account.emailVerified) throw new WorkflowError("Sign in with a verified account to use company workspaces.", 401);
  return session.account.accountId;
}
export function workflowSecret() {
  const secret = process.env.SERVICE_TOKEN_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret) < 32) throw new WorkflowError("Company storage is not configured.", 503);
  return secret;
}
export async function workflowToken(actor: string, scope: string) {
  return new SignJWT({ identity_authority: "first-party-v1", email_verified: true, scope })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: process.env.SERVICE_TOKEN_KEY_ID || "legacy" })
    .setIssuer("the-estimator-web").setAudience("the-estimator-go").setSubject(actor)
    .setIssuedAt().setExpirationTime("60s").setJti(randomUUID())
    .sign(new TextEncoder().encode(workflowSecret()));
}
export async function workflowResponse(path: string, method = "GET", body?: unknown, actor?: string, scope?: string) {
  const subject = actor ?? await workflowActor();
  const authorization = "Bearer " + await workflowToken(subject, scope ?? (method === "GET" ? "workflow:read" : "workflow:write"));
  return fetch(new URL("/v1/workflow/" + path, configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002")), {
    method, headers: { authorization, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(8000),
  });
}
export async function workflowData<T>(path: string, method = "GET", body?: unknown, actor?: string, scope?: string): Promise<T> {
  const response = await workflowResponse(path, method, body, actor, scope);
  const data = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Company operation failed.";
    throw new WorkflowError(message, response.status);
  }
  return data as T;
}
export async function companyAction(companyId: string, action: Record<string, unknown>, actor?: string) {
  return workflowData<{ company: Company; objectId: string }>(`companies/${companyId}/actions`, "POST", action, actor);
}
export async function briefWorkflow<T>(path: "extract" | "analyze" | "fetch", body: FormData | unknown): Promise<T> {
  const authorization = await briefServiceAuthorization(("workflow:" + path) as BriefServiceScope);
  if (!authorization) throw new WorkflowError("The internal analysis service is not configured.", 503);
  const multipart = body instanceof FormData;
  const response = await fetch(new URL("/v1/workflow/" + path, configuredServiceUrl("BRIEF_SERVICE_URL", "http://127.0.0.1:8001")), {
    method: "POST", headers: { authorization, ...(!multipart ? { "content-type": "application/json" } : {}) },
    body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(path === "analyze" ? 44000 : 15000), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "detail" in data && typeof data.detail === "string" ? data.detail : "Document or AI processing failed.";
    throw new WorkflowError(message, response.status);
  }
  return data as T;
}
export async function readWorkflowBody(request: Request, max = 2_000_000) {
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let count = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength; if (count > max) { await reader.cancel(); throw new WorkflowError("Request exceeds the upload limit.", 413); } parts.push(value); }
  const result = new Uint8Array(count); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
export async function extractAttachments(files: File[]): Promise<Attachment[]> {
  if (files.length > 10 || files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) throw new WorkflowError("Choose up to 10 files totaling 20 MB or less.", 413);
  const result: Attachment[] = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) throw new WorkflowError("Each file must be 10 MB or smaller.", 413);
    const form = new FormData(); form.append("file", file);
    const contentBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    try { result.push({ ...await briefWorkflow<Omit<Attachment, "id">>("extract", form), id: randomUUID(), contentBase64 }); }
    catch (error) { result.push({ id: randomUUID(), name: file.name.slice(0, 200), type: file.name.split(".").at(-1) ?? "", text: "", sha256: "", status: "needs_attention", error: error instanceof Error ? error.message : "Extraction failed.", truncated: false, locators: [], contentBase64 }); }
  }
  let remaining = 90000;
  for (const attachment of result) {
    if (attachment.text.length > remaining) {
      attachment.text = attachment.text.slice(0, remaining);
      attachment.truncated = true;
    }
    remaining -= attachment.text.length;
  }
  return result;
}
export async function analyzeCompanyRequest(companyId: string, requestId: string, actor: string, automatic = false) {
  const company = await workflowData<Company>("companies/" + companyId, "GET", undefined, actor);
  const request = company.requests.find(item => item.id === requestId);
  if (!request) throw new WorkflowError("Request not found.", 404);
  await companyAction(companyId, { action: "analysis.started", requestId, expectedRevision: request.revision, automatic }, actor);
  try {
    const sources = [{ name: "Message", text: request.text }, ...request.attachments.map((file,index) => ({ name: (index+1)+": "+file.name, text: file.text })).filter(file=>file.text)];
    const text = sources.map(source => `[${source.name}]\n${source.text}`).join("\n\n");
    const retrieved = await workflowData<{ passages: unknown[] }>(`companies/${companyId}/knowledge?q=${encodeURIComponent((request.title + " " + text).slice(0, 5000))}`, "GET", undefined, actor);
    const analysis = await briefWorkflow<Analysis>("analyze", { text, sources, configuration: company.config, knowledge: retrieved.passages });
    const fields: Record<string, unknown> = {};
    for (const fact of analysis.facts) {
      if (fact.status !== "source") continue;
      const field = company.config.fields.find(item => item.key === fact.key);
      if (!field) continue;
      if (field.type === "number") { const number = Number(fact.value); if (Number.isFinite(number)) fields[fact.key] = number; }
      else if (field.type === "boolean") { if (["true", "false"].includes(fact.value.toLowerCase())) fields[fact.key] = fact.value.toLowerCase() === "true"; }
      else fields[fact.key] = fact.value;
    }
    const review: ScopeReview = {
      requestType: analysis.requestType, productId: analysis.productId, fields,
      deliverables: analysis.deliverables, exclusions: analysis.exclusions, acceptance: analysis.acceptance,
      dependencies: analysis.dependencies, questions: analysis.questions, workPackages: analysis.workPackages,
      confirmed: false, confirmedBy: "",
    };
    return await companyAction(companyId, { action: "analysis", requestId, expectedRevision: request.revision, analysis, knowledge: retrieved.passages, review }, actor);
  } catch (error) {
    await companyAction(companyId, { action: "analysis.failed", requestId, expectedRevision: request.revision, error: error instanceof Error ? error.message : "Analysis failed." }, actor).catch(() => undefined);
    throw error;
  }
}
export function workerAuthorization() { return createHmac("sha256", workflowSecret()).update("company-sync-worker-v1").digest("hex"); }
export function equalSecret(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
