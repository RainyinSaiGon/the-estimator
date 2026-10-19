import type { ClientRequest, CompanyRole, CompanySummary } from "./client-workflow-types";
import { ClientWorkflowError } from "./workflow-errors";
import { companyRole, workflowDb } from "./workflow-governance";
import { normalizeWorkspaceQuery, type RequestInboxPage, type RequestSummary, type WorkspaceQuery } from "./workflow-query-types";

/** Authorization and count projection in one query, without hydrating every company's knowledge. */
export async function readCompanySummaries(actorId: string): Promise<CompanySummary[]> {
  const rows = await workflowDb().prepare(`
    SELECT c.id, c.name, c.version,
      CASE WHEN c.owner_id = ? THEN 'admin' ELSE m.role END AS role,
      (SELECT COUNT(*) FROM workflow_requests r WHERE r.company_id = c.id) AS requestCount
    FROM workflow_companies c
    LEFT JOIN workflow_members m ON m.company_id = c.id AND m.user_id = ?
    WHERE c.owner_id = ? OR m.user_id IS NOT NULL
    ORDER BY c.updated_at DESC, c.id DESC
  `).bind(actorId, actorId, actorId).all<CompanySummary>();
  return rows.results;
}

export async function requireReadableCompany(actorId: string, companyId: string): Promise<CompanyRole> {
  const role = await companyRole(companyId, actorId);
  if (!role) throw new ClientWorkflowError("Company workspace not found.", 404);
  return role;
}

/** Company authorization must be established before calling these internal read helpers. */
export async function readRequestInbox(companyId: string, input: WorkspaceQuery): Promise<RequestInboxPage> {
  const { limit, offset, query } = normalizeWorkspaceQuery(input);
  // instr treats user input literally, including SQL wildcard characters.
  const where = `company_id = ? AND (? = '' OR instr(lower(title), lower(?)) > 0 OR instr(lower(COALESCE(json_extract(payload, '$.text'), '')), lower(?)) > 0 OR instr(lower(status), lower(?)) > 0 OR instr(lower(COALESCE(json_extract(payload, '$.review.requestType'), '')), lower(?)) > 0)`;
  const bindings = [companyId, query, query, query, query, query];
  const [count, rows] = await Promise.all([
    workflowDb().prepare(`SELECT COUNT(*) AS n FROM workflow_requests WHERE ${where}`).bind(...bindings).first<{ n: number }>(),
    workflowDb().prepare(`SELECT id, title, status, version, created_at AS createdAt, updated_at AS updatedAt,
      COALESCE(json_extract(payload, '$.channel'), 'manual') AS channel,
      COALESCE(json_extract(payload, '$.cohort'), 'synthetic') AS cohort,
      COALESCE(json_extract(payload, '$.analysis.requestType'), json_extract(payload, '$.review.requestType'), 'demo') AS requestType,
      CASE WHEN json_type(payload, '$.analysis') = 'object' THEN 1 ELSE 0 END AS hasAnalysis
      FROM workflow_requests WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all<Omit<RequestSummary, "hasAnalysis"> & { hasAnalysis: number }>(),
  ]);
  return { items: rows.results.map(row => ({ ...row, hasAnalysis: Boolean(row.hasAnalysis) })), total: count?.n ?? 0, offset, limit, query };
}

export function publicWorkflowRequest(payload: string): ClientRequest {
  const request = JSON.parse(payload) as ClientRequest;
  request.attachments ??= [];
  for (const attachment of request.attachments) delete attachment.objectKey;
  return request;
}

export async function readRequestDetail(companyId: string, requestId: string): Promise<ClientRequest | undefined> {
  const row = await workflowDb().prepare("SELECT payload FROM workflow_requests WHERE company_id = ? AND id = ?").bind(companyId, requestId).first<{ payload: string }>();
  return row ? publicWorkflowRequest(row.payload) : undefined;
}

/** Keyset batches bound row hydration. No inbox limit or filter affects this iterator. */
export async function* iterateCompanyRequests(companyId: string): AsyncGenerator<ClientRequest> {
  let after = "";
  while (true) {
    const rows = await workflowDb().prepare("SELECT id, payload FROM workflow_requests WHERE company_id = ? AND id > ? ORDER BY id LIMIT 25").bind(companyId, after).all<{ id: string; payload: string }>();
    for (const row of rows.results) yield publicWorkflowRequest(row.payload);
    if (rows.results.length < 25) return;
    after = rows.results.at(-1)!.id;
  }
}

/** Legacy callers explicitly retain the complete collection-shaped response. */
export async function readCompanyRequests(companyId: string): Promise<ClientRequest[]> {
  const requests: ClientRequest[] = [];
  for await (const request of iterateCompanyRequests(companyId)) requests.push(request);
  return requests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}
