import { applyAction, completeCompanyEvaluation, completeCompanyRecords, ClientWorkflowError, ensureClientWorkflowSchema, getWorkspace, requestFile, responseError } from "../../../lib/client-workflow";
import { env } from "cloudflare:workers";
import { companyWorkspaceAccess } from "../../../lib/company-workspace-access";
import { requireCompanyRole } from "../../../lib/workflow-governance";
import { workflowDb } from "../../../lib/workflow-governance";
import { requireReadableCompany } from "../../../lib/workflow-queries";
import { normalizeWorkspaceQuery } from "../../../lib/workflow-query-types";
import { exportDeliveryRecords } from "../../../lib/workflow-evaluation";

export const dynamic = "force-dynamic";

function readWorkspaceQuery(url: URL) {
  return normalizeWorkspaceQuery({
    inbox: url.searchParams.get("inbox") === "1",
    offset: Number(url.searchParams.get("offset") ?? "0"),
    limit: Number(url.searchParams.get("limit") ?? "25"),
    query: url.searchParams.get("q") ?? "",
    requestId: url.searchParams.get("request") ?? undefined,
  });
}

async function rejectPost(request: Request, error: string, status: number) {
  // Consume small rejected uploads so the Worker proxy can reuse its connection.
  // Discard chunks without buffering; cancel oversized bodies instead.
  const reader = request.body?.getReader();
  if (reader) {
    try {
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 256000) { await reader.cancel(); break; }
      }
    } catch { /* Preserve the authorization rejection if the sender disconnects. */ }
  }
  return Response.json({ error }, { status });
}

export async function GET(request: Request) {
  const access = await companyWorkspaceAccess();
  if (!access) return Response.json({ error: "Sign in to open your company workspace." }, { status: 401 });
  const { user } = access;
  try {
    await ensureClientWorkflowSchema();
    const url = new URL(request.url);
    const companyId = url.searchParams.get("company") ?? undefined;
    const requestId = url.searchParams.get("request");
    const fileId = url.searchParams.get("file");
    if (companyId && requestId && fileId) return await requestFile(user.userId, companyId, requestId, fileId);
    const view = url.searchParams.get("view");
    if (view === "evaluation" || view === "export") {
      if (!companyId) throw new ClientWorkflowError("Choose a company workspace.", 400);
      if (view === "evaluation") return Response.json(await completeCompanyEvaluation(user.userId, companyId), { headers: { "Cache-Control": "private, no-store", "Content-Disposition": "attachment; filename=delivery-evaluation.json" } });
      await requireReadableCompany(user.userId, companyId);
      const records = completeCompanyRecords(user.userId, companyId);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await records.next();
            if (next.done) { controller.close(); return; }
            controller.enqueue(encoder.encode(JSON.stringify(exportDeliveryRecords([next.value])[0]) + "\n"));
          } catch (error) { controller.error(error); }
        },
        async cancel() { await records.return(undefined); },
      });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "private, no-store", "Content-Disposition": "attachment; filename=delivery-records.jsonl" } });
    }
    const workspace = await getWorkspace(user.userId, companyId, readWorkspaceQuery(url));
    return Response.json(workspace, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  const access = await companyWorkspaceAccess();
  if (!access) return rejectPost(request, "Sign in before changing company workspace data.", 401);
  const { user } = access;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return rejectPost(request, "This request must come from your workspace.", 403);
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  const storedKeys: string[] = [];
  let uploadedRequestId: string | undefined;
  try {
    let body: unknown;
    await ensureClientWorkflowSchema();
    if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 25 * 1024 * 1024) return Response.json({ error: "The combined upload must not exceed 20 MB." }, { status: 413 });
      const form = await request.formData();
      const serialized = form.get("payload");
      if (typeof serialized !== "string" || serialized.length > 1024000) return Response.json({ error: "The request metadata is missing or too large." }, { status: 400 });
      const parsed = JSON.parse(serialized) as { action?: string; companyId?: string; title?: string; text?: string; attachments?: Array<{ name: string; type: string; size: number; sha256: string; text: string; status: string; message?: string; locators: string[]; truncated: boolean }> };
      if (parsed.action !== "createRequest" || !parsed.companyId || typeof parsed.title !== "string") return Response.json({ error: "Files can only be attached to a new request." }, { status: 400 });
      const owned = await getWorkspace(user.userId, parsed.companyId, { inbox: true });
      if (!owned.company) return Response.json({ error: "Company workspace not found." }, { status: 404 });
      requireCompanyRole(owned.company.role, ["admin", "estimator"]);
      const files = form.getAll("files");
      const metadata = parsed.attachments ?? [];
      if (!files.length || files.length !== metadata.length || files.length > 10) return Response.json({ error: "Choose between 1 and 10 files and include their extraction results." }, { status: 400 });
      if (!bucket) return Response.json({ error: "Private file storage is not configured for this Site." }, { status: 503 });
      let total = 0;
      const requestId = crypto.randomUUID();
      uploadedRequestId = requestId;
      const attachments = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (!(file instanceof File)) throw new ClientWorkflowError("A request attachment was invalid.");
        const safeName = file.name.split(/[\\/]/).at(-1)?.slice(0, 200) ?? "attachment";
        const extension = safeName.split(".").at(-1)?.toLowerCase() ?? "";
        if (!new Set(["pdf", "docx", "xlsx", "csv", "txt", "md", "json", "eml"]).has(extension)) throw new ClientWorkflowError(`${safeName}: file type is not supported.`);
        if (!file.size || file.size > 10 * 1024 * 1024) throw new ClientWorkflowError(`${safeName}: each file must be 10 MB or smaller.`);
        total += file.size;
        if (total > 20 * 1024 * 1024) throw new ClientWorkflowError("The combined file size must not exceed 20 MB.");
        const details = metadata[index];
        if (!details || details.name !== safeName || details.type !== extension || details.size !== file.size || !/^[a-f0-9]{64}$/.test(details.sha256)) throw new ClientWorkflowError(`${safeName}: file metadata does not match the uploaded file.`);
        const bytes = await file.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
        if (hash !== details.sha256) throw new ClientWorkflowError(`${safeName}: file changed after extraction. Select it again.`);
        const id = crypto.randomUUID();
        const objectKey = `request-files/${encodeURIComponent(owned.company.ownerId)}/${parsed.companyId}/${requestId}/${id}`;
        await bucket.put(objectKey, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { ownerId: owned.company.ownerId, companyId: parsed.companyId, requestId, fileId: id, sha256: hash } });
        storedKeys.push(objectKey);
        attachments.push({ ...details, name: safeName, id, objectKey });
      }
      body = { ...parsed, requestId, uploadVerified: true, attachments };
    } else {
      const serialized = await request.text();
      if (serialized.length > 256000) return Response.json({ error: "This workspace request is too large." }, { status: 413 });
      const parsed = JSON.parse(serialized) as { action?: string; attachments?: unknown[] };
      if (parsed.action === "createRequest" && Array.isArray(parsed.attachments) && parsed.attachments.length > 0) return Response.json({ error: "Request files must use the private file upload route." }, { status: 400 });
      body = parsed;
    }
    if (access.publicDemo && body && typeof body === "object" && (body as { action?: unknown }).action === "createRequest") {
      body = { ...(body as Record<string, unknown>), cohort: "synthetic" };
    }
    return Response.json(await applyAction(user.userId, user.displayName, body, undefined, readWorkspaceQuery(new URL(request.url))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Keep originals if the record committed but analysis or response loading failed.
    const persisted = uploadedRequestId ? await workflowDb().prepare("SELECT id FROM workflow_requests WHERE id = ?").bind(uploadedRequestId).first().catch(() => true) : false;
    if (!persisted && bucket && storedKeys.length) await bucket.delete(storedKeys).catch(() => undefined);
    return responseError(error);
  }
}
