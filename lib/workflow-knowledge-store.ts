import { auditStatement, workflowDb } from "./workflow-governance";
import { ClientWorkflowError } from "./workflow-errors";
import { normalizeKnowledgeDomain } from "./workflow-knowledge-fetch";

export type StoredKnowledgePolicy = { allowedDomains: string[]; version: number };
export type StoredKnowledgeFetch = { retrievedAt: string; contentType: string; sha256: string; truncated: boolean; byteLength: number };

let schemaReady: Promise<void> | undefined;
export async function ensureWorkflowKnowledgeSchema() {
  schemaReady ??= (async () => {
    const db = workflowDb();
    try {
      await db.prepare("CREATE TABLE IF NOT EXISTS workflow_knowledge_policy (company_id TEXT PRIMARY KEY NOT NULL, allowed_domains TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)").run();
      await db.prepare("CREATE TABLE IF NOT EXISTS workflow_knowledge_fetches (company_id TEXT NOT NULL, source_id TEXT NOT NULL, retrieved_at TEXT NOT NULL, content_type TEXT NOT NULL, sha256 TEXT NOT NULL, truncated INTEGER NOT NULL DEFAULT 0, byte_length INTEGER NOT NULL, PRIMARY KEY (company_id, source_id))").run();
    } catch (error) {
      schemaReady = undefined;
      throw error;
    }
  })();
  return schemaReady;
}

export function normalizeKnowledgeDomains(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 25) throw new ClientWorkflowError("Add at most 25 approved source domains.");
  const domains = value.map(item => {
    if (typeof item !== "string" || item.length > 253) throw new ClientWorkflowError("An approved source domain is invalid.");
    try { return normalizeKnowledgeDomain(item); }
    catch (error) { throw new ClientWorkflowError(error instanceof Error ? error.message : "An approved source domain is invalid."); }
  });
  if (new Set(domains).size !== domains.length) throw new ClientWorkflowError("Approved source domains must be unique.");
  return domains.sort();
}

export async function readKnowledgePolicy(companyId: string): Promise<StoredKnowledgePolicy> {
  const db = workflowDb();
  await db.prepare("INSERT OR IGNORE INTO workflow_knowledge_policy (company_id, allowed_domains, version, updated_at) VALUES (?, '[]', 1, ?)").bind(companyId, new Date().toISOString()).run();
  const row = await db.prepare("SELECT allowed_domains AS allowedDomains, version FROM workflow_knowledge_policy WHERE company_id = ?").bind(companyId).first<{ allowedDomains: string; version: number }>();
  if (!row) throw new ClientWorkflowError("Knowledge source policy could not be loaded.", 503);
  try { return { allowedDomains: normalizeKnowledgeDomains(JSON.parse(row.allowedDomains)), version: row.version }; }
  catch { throw new ClientWorkflowError("The saved knowledge-domain allowlist is invalid. Contact the workspace administrator.", 503); }
}

export async function updateKnowledgePolicy(companyId: string, actorId: string, domains: string[], expectedVersion: number) {
  const db = workflowDb();
  const updatedAt = new Date().toISOString();
  const [result] = await db.batch([
    db.prepare("UPDATE workflow_knowledge_policy SET allowed_domains = ?, version = version + 1, updated_at = ? WHERE company_id = ? AND version = ?").bind(JSON.stringify(domains), updatedAt, companyId, expectedVersion),
    db.prepare("INSERT INTO workflow_audit (id, company_id, request_id, actor, action, created_at) SELECT ?, ?, '', ?, 'knowledge.domains.updated', ? WHERE changes() = 1").bind(crypto.randomUUID(), companyId, actorId, updatedAt),
  ]);
  if (!result?.meta?.changes) throw new ClientWorkflowError("The source policy changed in another session. Refresh and retry.", 409);
}

export async function saveKnowledgeFetchMetadata(companyId: string, sourceId: string, actorId: string, metadata: StoredKnowledgeFetch) {
  const db = workflowDb();
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO workflow_knowledge_fetches (company_id, source_id, retrieved_at, content_type, sha256, truncated, byte_length) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(companyId, sourceId, metadata.retrievedAt, metadata.contentType, metadata.sha256, metadata.truncated ? 1 : 0, metadata.byteLength),
    auditStatement(companyId, actorId, "knowledge.source.fetched"),
  ]);
}

export async function readKnowledgeFetchMetadata(companyId: string): Promise<Record<string, StoredKnowledgeFetch>> {
  const rows = await workflowDb().prepare("SELECT source_id AS sourceId, retrieved_at AS retrievedAt, content_type AS contentType, sha256, truncated, byte_length AS byteLength FROM workflow_knowledge_fetches WHERE company_id = ?").bind(companyId).all<{ sourceId: string; retrievedAt: string; contentType: string; sha256: string; truncated: number; byteLength: number }>();
  return Object.fromEntries(rows.results.map(row => [row.sourceId, { retrievedAt: row.retrievedAt, contentType: row.contentType, sha256: row.sha256, truncated: row.truncated === 1, byteLength: row.byteLength }]));
}
