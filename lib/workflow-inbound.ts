import { env } from "cloudflare:workers";
import { z } from "zod";
import { applyAction, ensureClientWorkflowSchema } from "./client-workflow";
import { ClientWorkflowError } from "./workflow-errors";
import { revealWebhookCredential, textDigest, workflowDb } from "./workflow-governance";
import type { RequestAttachment } from "./client-workflow-types";

const payloadSchema = z.object({ submissionId: z.string().trim().min(1).max(200), title: z.string().trim().min(3).max(200), text: z.string().max(20000).default(""), cohort: z.enum(["synthetic", "recorded"]), attachments: z.array(z.object({ name: z.string().min(1).max(200), contentBase64: z.string().min(1).max(2800000) })).max(10).default([]) });

export async function readBoundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new ClientWorkflowError("The inbound payload exceeds 5 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ClientWorkflowError("The inbound body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ClientWorkflowError("The inbound payload exceeds 5 MB.", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

async function extractInbound(bytes: Uint8Array, extension: string) {
  let text = "", locators: string[] = [];
  if (extension === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
    const paragraphs = result.value.split(/\n\s*\n/).filter(Boolean);
    text = paragraphs.map((paragraph, index) => `[Paragraph ${index + 1}] ${paragraph}`).join("\n\n");
    locators = paragraphs.map((_, index) => `Paragraph ${index + 1}`);
  } else if (extension === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "array", cellFormula: false, cellHTML: false, bookVBA: false });
    text = workbook.SheetNames.slice(0, 30).map(name => `[Sheet: ${name}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join("\n\n");
    locators = workbook.SheetNames.slice(0, 30).map(name => `Sheet ${name}`);
  } else if (extension !== "pdf") {
    text = new TextDecoder().decode(bytes);
    if (extension === "csv") {
      text = text.split(/\r?\n/).map((line, index) => `[Row ${index + 1}] ${line}`).join("\n");
      locators = text.split(/\r?\n/).map((_, index) => `Row ${index + 1}`);
    } else locators = ["Document text"];
  }
  return { text: text.slice(0, 40000), locators: locators.slice(0, 200), truncated: text.length > 40000, status: text.trim() ? "extracted" as const : "needs_attention" as const, ...(!text.trim() ? { message: extension === "pdf" ? "PDF received securely. This webhook adapter cannot extract its pages. Review the original and reconcile its contents in scope review, or submit it through the workspace for page-aware extraction." : "No readable text was extracted. Review the original before confirming scope." } : {}) };
}

export async function receiveInbound(request: Request, companyId: string) {
  if (!z.string().uuid().safeParse(companyId).success) throw new ClientWorkflowError("Company not found.", 404);
  await ensureClientWorkflowSchema();
  // Consume the bounded request body even when rejecting stale headers.
  // This also keeps local HTTP proxy connections reusable after a rejection.
  const raw = await readBoundedBody(request, 5 * 1024 * 1024);
  const timestamp = request.headers.get("x-workflow-timestamp") ?? "";
  if (!z.string().datetime().safeParse(timestamp).success || Math.abs(Date.now() - Date.parse(timestamp)) > 300000) throw new ClientWorkflowError("The webhook timestamp is missing or expired.", 401);
  const signature = request.headers.get("x-workflow-signature") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new ClientWorkflowError("A valid webhook signature is required.", 401);
  const secret = await revealWebhookCredential(companyId);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signatureBytes = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(`${timestamp}.${raw}`))) throw new ClientWorkflowError("Invalid webhook signature.", 401);
  const input = payloadSchema.parse(JSON.parse(raw));
  const payloadDigest = await textDigest(raw);
  const existing = await workflowDb().prepare("SELECT payload_digest, request_id FROM workflow_inbound WHERE company_id = ? AND submission_id = ?").bind(companyId, input.submissionId).first<{ payload_digest: string; request_id: string }>();
  if (existing) {
    if (existing.payload_digest !== payloadDigest) throw new ClientWorkflowError("This submission ID already exists with different content. Use a new event ID for a revision.", 409);
    return { requestId: existing.request_id, duplicate: true };
  }
  const company = await workflowDb().prepare("SELECT owner_id FROM workflow_companies WHERE id = ?").bind(companyId).first<{ owner_id: string }>();
  if (!company) throw new ClientWorkflowError("Company not found.", 404);
  const requestId = crypto.randomUUID();
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (input.attachments.length && !bucket) throw new ClientWorkflowError("Private attachment storage is unavailable.", 503);
  const attachments: RequestAttachment[] = [];
  const storedKeys: string[] = [];
  let total = 0;
  try {
    for (const item of input.attachments) {
      const name = item.name.split(/[\\/]/).at(-1)!;
      const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
      if (!["pdf", "docx", "xlsx", "csv", "txt", "md", "json", "eml"].includes(extension)) throw new ClientWorkflowError(`${name}: unsupported file type.`);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.contentBase64)) throw new ClientWorkflowError(`${name}: invalid Base64.`);
      const bytes = Uint8Array.from(atob(item.contentBase64), char => char.charCodeAt(0));
      total += bytes.length;
      if (!bytes.length || bytes.length > 2 * 1024 * 1024 || total > 4 * 1024 * 1024) throw new ClientWorkflowError("Webhook files must be at most 2 MB each and 4 MB combined.", 413);
      const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const id = crypto.randomUUID();
      const objectKey = `request-files/${encodeURIComponent(company.owner_id)}/${companyId}/${requestId}/${id}`;
      let extraction: Awaited<ReturnType<typeof extractInbound>>;
      try { extraction = await extractInbound(bytes, extension); }
      catch { extraction = { text: "", locators: [], truncated: false, status: "needs_attention", message: "This attachment could not be extracted. Review the original and reconcile missing content before confirming scope." }; }
      await bucket!.put(objectKey, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { ownerId: company.owner_id, companyId, requestId, fileId: id, sha256 } });
      storedKeys.push(objectKey);
      attachments.push({ id, objectKey, name, type: extension, size: bytes.length, sha256, ...extraction });
    }
    await applyAction(company.owner_id, "Authorized form webhook", { action: "createRequest", companyId, requestId, title: input.title, text: input.text, cohort: input.cohort, uploadVerified: true, attachments }, { submissionId: input.submissionId, payloadDigest });
    return { requestId, duplicate: false };
  } catch (error) {
    const persisted = await workflowDb().prepare("SELECT request_id, payload_digest FROM workflow_inbound WHERE company_id = ? AND submission_id = ?").bind(companyId, input.submissionId).first<{ request_id: string; payload_digest: string }>();
    if (!persisted || persisted.request_id !== requestId) { if (bucket && storedKeys.length) await bucket.delete(storedKeys); }
    if (persisted?.payload_digest === payloadDigest && persisted.request_id !== requestId) return { requestId: persisted.request_id, duplicate: true };
    throw error;
  }
}
