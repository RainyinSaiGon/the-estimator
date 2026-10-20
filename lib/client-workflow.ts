import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { workflowCompanies } from "../db/schema";
import { aiConfig } from "./brief-ai";
import { type WorkspaceResponse } from "./client-workflow-types";
import { ClientWorkflowError } from "./workflow-errors";
import { governanceStatements, governanceView } from "./workflow-governance";
import { ensureWorkflowKnowledgeSchema, readKnowledgeFetchMetadata } from "./workflow-knowledge-store";
import { actionSchema } from "./workflow-validation";
import { readCompanyActivity } from "./workflow-activity";
import { readCompanyRequests, readCompanySummaries, readRequestDetail, readRequestInbox } from "./workflow-queries";
import { normalizeWorkspaceQuery, type WorkspaceQuery } from "./workflow-query-types";
import { ownedRequest, parseCompany } from "./workflow-command-repository";
import { executeWorkflowCommand } from "./workflow-commands";
export { ClientWorkflowError } from "./workflow-errors";

let workflowSchemaReady: Promise<void> | undefined;
export function ensureClientWorkflowSchema() {
  if (!env.DB)
    throw new ClientWorkflowError(
      "Company storage is not ready. The Site D1 binding is missing.",
      503,
    );
  workflowSchemaReady ??= (async () => {
    const statements = [
      "CREATE TABLE IF NOT EXISTS workflow_companies (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS workflow_companies_owner_updated ON workflow_companies (owner_id, updated_at)",
      "CREATE TABLE IF NOT EXISTS workflow_requests (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, company_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS workflow_requests_owner_company_updated ON workflow_requests (owner_id, company_id, updated_at)",
      "CREATE INDEX IF NOT EXISTS workflow_requests_company_status ON workflow_requests (company_id, status)",
      "CREATE INDEX IF NOT EXISTS workflow_requests_company_updated_id ON workflow_requests (company_id, updated_at DESC, id DESC)",
      "CREATE INDEX IF NOT EXISTS workflow_requests_company_id ON workflow_requests (company_id, id)",
      "CREATE TABLE IF NOT EXISTS workflow_export_snapshots (id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS workflow_export_snapshots_company_expiry ON workflow_export_snapshots (company_id, expires_at)",
      "CREATE TABLE IF NOT EXISTS workflow_export_snapshot_items (snapshot_id TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (snapshot_id, request_id))",
      "CREATE TABLE IF NOT EXISTS workflow_object_deletions (object_key TEXT PRIMARY KEY NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, created_at TEXT NOT NULL, last_error TEXT)",
      "CREATE INDEX IF NOT EXISTS workflow_object_deletions_due ON workflow_object_deletions (available_at, created_at)",
      ...governanceStatements,
    ];
    try {
      for (const statement of statements) await env.DB!.prepare(statement).run();
    } catch (error) {
      workflowSchemaReady = undefined;
      throw error;
    }
  })();
  return workflowSchemaReady;
}

export async function getWorkspace(
  actorId: string,
  companyId?: string,
  query: WorkspaceQuery = {},
): Promise<WorkspaceResponse> {
  const summary = await readCompanySummaries(actorId);
  const selectedId = companyId ?? summary[0]?.id;
  if (companyId && !summary.some(row => row.id === companyId))
    throw new ClientWorkflowError("Company workspace not found.", 404);
  const [selected] = selectedId ? await getDb().select().from(workflowCompanies).where(eq(workflowCompanies.id, selectedId)).limit(1) : [];
  const options = normalizeWorkspaceQuery(query);
  const selectedCompany = selected ? parseCompany(selected) : undefined;
  if (!selected || !selectedCompany) return { companies: summary, actorId, aiReady: Boolean(aiConfig().key) };
  const [knowledgeMetadata, governance, activity, inbox] = await Promise.all([
    (async () => { await ensureWorkflowKnowledgeSchema(); return readKnowledgeFetchMetadata(selected.id); })(),
    governanceView(selected.id, selected.ownerId),
    readCompanyActivity(selected.id, selectedCompany.config),
    options.inbox ? readRequestInbox(selected.id, options) : Promise.resolve(undefined),
  ]);
  const detail = options.inbox && options.requestId ? await readRequestDetail(selected.id, options.requestId) : undefined;
  const requests = options.inbox
    ? detail ? [detail] : []
    : await readCompanyRequests(selected.id);
  selectedCompany.knowledge = selectedCompany.knowledge.map(source => ({ ...source, ...knowledgeMetadata[source.id] }));
  return {
    companies: summary,
    actorId,
    aiReady: Boolean(aiConfig().key),
    ...(inbox ? { inbox } : {}),
    ...(detail ? { selectedId: detail.id } : {}),
    company: {
      ...selectedCompany,
      role: summary.find(row => row.id === selected.id)!.role,
      ...governance,
      requests,
      ...activity,
    },
  };
}

export { completeCompanyEvaluation, createCompanyRecordsExport } from "./workflow-export-snapshots";

export async function applyAction(
  actorId: string,
  userName: string,
  raw: unknown,
  inbound?: { submissionId: string; payloadDigest: string },
  responseQuery: WorkspaceQuery = {},
): Promise<WorkspaceResponse> {
  const input = actionSchema.parse(raw);
  const result = await executeWorkflowCommand(input, {
    actorId,
    userName,
    at: new Date().toISOString(),
    inbound,
  });
  return {
    ...(await getWorkspace(actorId, result.companyId, {
      ...responseQuery,
      ...(result.requestId ? { requestId: result.requestId } : {}),
    })),
    ...(result.issuedCredential ? { issuedCredential: result.issuedCredential } : {}),
  };

}

export const responseError = (error: unknown) => {
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      },
      { status: 400 },
    );
  if (error instanceof ClientWorkflowError)
    return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "The workspace request failed.";
  if (/no such table|binding.*unavailable/i.test(message))
    return Response.json(
      { error: "Company storage is not ready. Apply the database migration." },
      { status: 503 },
    );
  return Response.json({ error: "The workspace request could not be completed." }, { status: 500 });
};

export async function requestFile(
  ownerId: string,
  companyId: string,
  requestId: string,
  fileId: string,
) {
  const { request, row } = await ownedRequest(ownerId, companyId, requestId);
  const file = request.attachments.find((item) => item.id === fileId && item.objectKey);
  if (!file?.objectKey) throw new ClientWorkflowError("Source file not found.", 404);
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!bucket) throw new ClientWorkflowError("Source file storage is not ready.", 503);
  const object = await bucket.get(file.objectKey);
  if (
    !object ||
    object.customMetadata?.ownerId !== row.ownerId ||
    object.customMetadata?.companyId !== companyId ||
    object.customMetadata?.requestId !== requestId ||
    object.customMetadata?.fileId !== fileId ||
    object.customMetadata?.sha256 !== file.sha256
  )
    throw new ClientWorkflowError("Source file not found.", 404);
  const filename = file.name.replace(/["\\\r\n]/g, "_");
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
