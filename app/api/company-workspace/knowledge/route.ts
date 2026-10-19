import { applyAction, ClientWorkflowError, ensureClientWorkflowSchema, getWorkspace, responseError } from "../../../../lib/client-workflow";
import { requireCompanyRole } from "../../../../lib/workflow-governance";
import { fetchApprovedKnowledgeSource, KnowledgeFetchError } from "../../../../lib/workflow-knowledge-fetch";
import { ensureWorkflowKnowledgeSchema, normalizeKnowledgeDomains, readKnowledgeFetchMetadata, readKnowledgePolicy, saveKnowledgeFetchMetadata, updateKnowledgePolicy } from "../../../../lib/workflow-knowledge-store";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

async function companyForUser(actorId: string, companyId?: string) {
  const workspace = await getWorkspace(actorId, companyId);
  if (!workspace.company) throw new ClientWorkflowError("Company workspace not found.", 404);
  requireCompanyRole(workspace.company.role, ["admin"]);
  return { workspace, company: workspace.company };
}

function errorResponse(error: unknown) {
  if (error instanceof KnowledgeFetchError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  return responseError(error);
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to manage company knowledge." }, { status: 401 });
  try {
    await ensureClientWorkflowSchema();
    await ensureWorkflowKnowledgeSchema();
    const companyId = new URL(request.url).searchParams.get("company") ?? undefined;
    const { company } = await companyForUser(user.userId, companyId);
    const [policy, metadata] = await Promise.all([readKnowledgePolicy(company.id), readKnowledgeFetchMetadata(company.id)]);
    const sources = company.knowledge.map(source => ({
      id: source.id, title: source.title, url: source.url, text: source.text,
      status: source.status, sha256: metadata[source.id]?.sha256 ?? source.sha256, addedAt: source.addedAt,
      approvedAt: source.approvedAt, approvedBy: source.approvedBy,
      fetched: Boolean(metadata[source.id]), retrievedAt: metadata[source.id]?.retrievedAt ?? source.addedAt,
      contentType: metadata[source.id]?.contentType ?? "manually supplied",
      truncated: metadata[source.id]?.truncated ?? false,
      byteLength: metadata[source.id]?.byteLength ?? new TextEncoder().encode(source.text).byteLength,
    }));
    return Response.json({ company: { id: company.id, name: company.name, version: company.version }, policyVersion: policy.version, allowedDomains: policy.allowedDomains, sources }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

async function rejectPost(request: Request, message: string, status: number) {
  const reader = request.body?.getReader();
  if (reader) {
    try {
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 32_000) { await reader.cancel(); break; }
      }
    } catch { /* Preserve the authorization rejection. */ }
  }
  return Response.json({ error: message }, { status });
}

async function readActionBody(request: Request) {
  const maxBytes = 32_000;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new ClientWorkflowError("The knowledge action is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ClientWorkflowError("The knowledge action is too large.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return rejectPost(request, "Sign in before changing company knowledge.", 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return rejectPost(request, "This request must come from your workspace.", 403);
  try {
    await ensureClientWorkflowSchema();
    await ensureWorkflowKnowledgeSchema();
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) throw new ClientWorkflowError("Send a JSON knowledge action.", 415);
    const text = await readActionBody(request);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new ClientWorkflowError("The knowledge action must contain valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ClientWorkflowError("The knowledge action is invalid.");
    const input = body as Record<string, unknown>;
    if (typeof input.companyId !== "string") throw new ClientWorkflowError("Choose a company workspace.");
    const { company } = await companyForUser(user.userId, input.companyId);

    if (input.action === "setAllowedDomains") {
      const domains = normalizeKnowledgeDomains(input.domains);
      const version = Number(input.policyVersion);
      if (!Number.isInteger(version) || version < 1) throw new ClientWorkflowError("Refresh the source policy before saving.", 409);
      await updateKnowledgePolicy(company.id, user.userId, domains, version);
      return GET(new Request(`${new URL(request.url).origin}/api/company-workspace/knowledge?company=${encodeURIComponent(company.id)}`, { headers: request.headers }));
    }

    if (input.action === "fetchSource") {
      const expectedVersion = Number(input.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion !== company.version) throw new ClientWorkflowError("Company settings changed in another session. Refresh and try again.", 409);
      if (typeof input.url !== "string") throw new ClientWorkflowError("Enter a public documentation URL.");
      const policy = await readKnowledgePolicy(company.id);
      if (!policy.allowedDomains.length) throw new ClientWorkflowError("Approve at least one public source domain before fetching documentation.", 409);
      const fetched = await fetchApprovedKnowledgeSource(input.url, policy.allowedDomains);
      const before = new Set(company.knowledge.map(source => source.id));
      const updatedWorkspace = await applyAction(user.userId, user.displayName, { action: "addKnowledge", companyId: company.id, expectedVersion, title: fetched.title, url: fetched.url, text: fetched.text });
      const updatedCompany = updatedWorkspace.company;
      if (!updatedCompany) throw new ClientWorkflowError("The fetched source could not be saved.", 503);
      const source = updatedCompany.knowledge.find(item => !before.has(item.id) && item.url === fetched.url && item.text === fetched.text);
      if (!source) throw new ClientWorkflowError("The fetched source was saved but its review record could not be identified.", 503);
      await saveKnowledgeFetchMetadata(company.id, source.id, user.userId, fetched);
      return GET(new Request(`${new URL(request.url).origin}/api/company-workspace/knowledge?company=${encodeURIComponent(company.id)}`, { headers: request.headers }));
    }

    if (input.action === "approveSource" || input.action === "retireSource") {
      if (typeof input.sourceId !== "string" || typeof input.expectedVersion !== "number") throw new ClientWorkflowError("Choose a source and refresh before applying this action.");
      return Response.json(await applyAction(user.userId, user.displayName, {
        action: input.action === "approveSource" ? "approveKnowledge" : "retireKnowledge",
        companyId: company.id, knowledgeId: input.sourceId, expectedVersion: input.expectedVersion,
      }), { headers: { "Cache-Control": "private, no-store" } });
    }

    throw new ClientWorkflowError("Unknown company knowledge action.");
  } catch (error) { return errorResponse(error); }
}
