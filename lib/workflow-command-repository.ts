import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { workflowCompanies, workflowRequests } from "../db/schema";
import type { ClientRequest, Company, CompanyConfig, CompanyRole, KnowledgeSource } from "./client-workflow-types";
import { ClientWorkflowError } from "./workflow-errors";
import { evaluateDeliveries } from "./workflow-evaluation";
import { auditStatement, companyRole, governanceView, workflowDb } from "./workflow-governance";
import { ensureWorkflowKnowledgeSchema, readKnowledgeFetchMetadata } from "./workflow-knowledge-store";

export function parseCompany(row: typeof workflowCompanies.$inferSelect): Company {
  const data = JSON.parse(row.payload) as Omit<Company, "id" | "name" | "version" | "role">;
  return {
    ...data,
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    version: row.version,
    role: "admin",
    requests: [],
    members: [],
    connectors: { webhookConfigured: false, mcpConfigured: false, encryptionReady: false },
    audit: [],
    evaluation: evaluateDeliveries([]),
  };
}
export function parseRequest(row: typeof workflowRequests.$inferSelect): ClientRequest {
  const request = JSON.parse(row.payload) as ClientRequest;
  return { ...request, attachments: request.attachments ?? [] };
}
export async function ownedCompany(ownerId: string, companyId: string): Promise<Company> {
  const role = await companyRole(companyId, ownerId);
  if (!role) throw new ClientWorkflowError("Company workspace not found.", 404);
  await ensureWorkflowKnowledgeSchema();
  const [row] = await getDb()
    .select()
    .from(workflowCompanies)
    .where(eq(workflowCompanies.id, companyId))
    .limit(1);
  const company = parseCompany(row);
  const metadata = await readKnowledgeFetchMetadata(companyId);
  company.knowledge = company.knowledge.map((source) => ({
    ...source,
    ...(metadata[source.id]
      ? {
          retrievedAt: metadata[source.id]!.retrievedAt,
          contentType: metadata[source.id]!.contentType,
          truncated: metadata[source.id]!.truncated,
        }
      : {}),
  }));
  return { ...company, role, ...(await governanceView(companyId, row.ownerId)) };
}
export async function ownedRequest(
  ownerId: string,
  companyId: string,
  requestId: string,
  expectedVersion?: number,
) {
  await ownedCompany(ownerId, companyId);
  const [row] = await getDb()
    .select()
    .from(workflowRequests)
    .where(and(eq(workflowRequests.id, requestId), eq(workflowRequests.companyId, companyId)))
    .limit(1);
  if (!row) throw new ClientWorkflowError("Request not found.", 404);
  if (expectedVersion !== undefined && row.version !== expectedVersion)
    throw new ClientWorkflowError(
      "This request changed in another session. Refresh before saving.",
      409,
    );
  return { row, request: parseRequest(row) };
}
export async function saveRequest(
  ownerId: string,
  request: ClientRequest,
  expectedVersion: number,
  companyId: string,
  actorId: string,
  action: string,
) {
  const db = workflowDb();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE workflow_requests SET title = ?, status = ?, version = ?, payload = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND company_id = ? AND version = ?",
      )
      .bind(
        request.title,
        request.status,
        request.version,
        JSON.stringify(request),
        request.updatedAt,
        request.id,
        ownerId,
        companyId,
        expectedVersion,
      ),
    db
      .prepare(
        "INSERT INTO workflow_audit (id, company_id, request_id, actor, action, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1",
      )
      .bind(crypto.randomUUID(), companyId, request.id, actorId, action, request.updatedAt),
  ]);
  if (result[0].meta.changes !== 1)
    throw new ClientWorkflowError("This request changed while saving. Refresh and retry.", 409);
}

/** D1 batches roll back every statement if the mutation or audit insert fails. */
export async function createCompanyRecord(actorId: string, name: string, config: CompanyConfig, at: string) {
  const count = await workflowDb()
    .prepare("SELECT COUNT(*) AS n FROM workflow_companies WHERE owner_id = ?")
    .bind(actorId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= 50)
    throw new ClientWorkflowError("This account supports at most 50 company workspaces.");
  const id = crypto.randomUUID();
  const db = workflowDb();
  await db.batch([
    db.prepare("INSERT INTO workflow_companies (id, owner_id, name, version, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, actorId, name, 1, JSON.stringify({ config, knowledge: [] }), at, at),
    auditStatement(id, actorId, "company.created"),
  ]);
  return id;
}

export async function saveCompanyRecord(
  company: Company,
  config: CompanyConfig,
  knowledge: KnowledgeSource[],
  actorId: string,
  action: string,
  at: string,
  conflictMessage: string,
) {
  const db = workflowDb();
  const result = await db.batch([
    db.prepare("UPDATE workflow_companies SET name = ?, version = ?, payload = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?")
      .bind(company.name, company.version + 1, JSON.stringify({ config, knowledge }), at, company.id, company.ownerId, company.version),
    // Keep this adjacent to the guarded UPDATE: a stale version emits no success event.
    db.prepare("INSERT INTO workflow_audit (id, company_id, request_id, actor, action, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1")
      .bind(crypto.randomUUID(), company.id, "", actorId, action, at),
  ]);
  if (result[0].meta.changes !== 1)
    throw new ClientWorkflowError(conflictMessage, 409);
}

export async function saveMemberRecord(
  companyId: string,
  member: { action: "setMember"; userId: string; displayName: string; role: CompanyRole } | { action: "removeMember"; userId: string },
  actorId: string,
  at: string,
) {
  await workflowDb().batch([
    member.action === "setMember"
      ? workflowDb()
          .prepare(
            "INSERT INTO workflow_members (company_id, user_id, display_name, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, user_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role",
          )
          .bind(companyId, member.userId, member.displayName, member.role, at)
      : workflowDb()
          .prepare("DELETE FROM workflow_members WHERE company_id = ? AND user_id = ?")
          .bind(companyId, member.userId),
    auditStatement(
      companyId,
      actorId,
      member.action === "setMember"
        ? `member.set:${member.userId}:${member.role}`
        : `member.removed:${member.userId}`,
    ),
  ]);
}

export async function revokeCredentialRecord(companyId: string, kind: "webhook" | "mcp", actorId: string) {
  await workflowDb().batch([
    workflowDb()
      .prepare("DELETE FROM workflow_credentials WHERE company_id = ? AND kind = ?")
      .bind(companyId, kind),
    auditStatement(companyId, actorId, `${kind}.revoked`),
  ]);
}

export async function saveCredentialRecord(companyId: string, kind: "webhook" | "mcp", verifier: string, actorId: string, at: string) {
  await workflowDb().batch([
    workflowDb()
      .prepare(
        "INSERT INTO workflow_credentials (company_id, kind, verifier, issued_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, kind) DO UPDATE SET verifier = excluded.verifier, issued_by = excluded.issued_by, created_at = excluded.created_at",
      )
      .bind(companyId, kind, verifier, actorId, at),
    auditStatement(companyId, actorId, `${kind}.rotated`),
  ]);
}

export async function createRequestRecord(
  request: ClientRequest,
  ownerId: string,
  companyId: string,
  intakeActor: string,
  at: string,
  inbound?: { submissionId: string; payloadDigest: string },
) {
  const statements = [
    workflowDb()
      .prepare(
        "INSERT INTO workflow_requests (id, owner_id, company_id, title, status, version, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        request.id,
        ownerId,
        companyId,
        request.title,
        request.status,
        request.version,
        JSON.stringify(request),
        at,
        at,
      ),
    auditStatement(companyId, intakeActor, "request.received", request.id),
  ];
  if (inbound)
    statements.unshift(
      workflowDb()
        .prepare(
          "INSERT INTO workflow_inbound (company_id, submission_id, payload_digest, request_id, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(companyId, inbound.submissionId, inbound.payloadDigest, request.id, at),
    );
  await workflowDb().batch(statements);
}

export async function deleteRequestRecord(requestId: string, ownerId: string, companyId: string, expectedVersion: number) {
  const db = getDb();
  const deleted = await db
    .delete(workflowRequests)
    .where(
      and(
        eq(workflowRequests.id, requestId),
        eq(workflowRequests.ownerId, ownerId),
        eq(workflowRequests.companyId, companyId),
        eq(workflowRequests.version, expectedVersion),
      ),
    )
    .returning({ id: workflowRequests.id });
  if (!deleted.length)
    throw new ClientWorkflowError("This request changed while deleting. Refresh and retry.", 409);
}

export async function readRequestHistory(companyId: string, requestId: string) {
  const historyRows = await getDb()
    .select()
    .from(workflowRequests)
    .where(eq(workflowRequests.companyId, companyId));
  return historyRows.filter((item) => item.id !== requestId).map(parseRequest);
}
