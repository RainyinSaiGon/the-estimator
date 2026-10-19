import { env } from "cloudflare:workers";
import { ClientWorkflowError } from "./workflow-errors";
import type { CompanyMember, CompanyRole, WorkflowAudit } from "./client-workflow-types";

export const governanceStatements = [
  "CREATE TABLE IF NOT EXISTS workflow_members (company_id TEXT NOT NULL, user_id TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (company_id, user_id))",
  "CREATE INDEX IF NOT EXISTS workflow_members_user ON workflow_members (user_id, company_id)",
  "CREATE TABLE IF NOT EXISTS workflow_credentials (company_id TEXT NOT NULL, kind TEXT NOT NULL, verifier TEXT NOT NULL, issued_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (company_id, kind))",
  "CREATE TABLE IF NOT EXISTS workflow_inbound (company_id TEXT NOT NULL, submission_id TEXT NOT NULL, payload_digest TEXT NOT NULL, request_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (company_id, submission_id))",
  "CREATE TABLE IF NOT EXISTS workflow_audit (id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, request_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS workflow_audit_company ON workflow_audit (company_id, created_at)",
];

export function workflowDb() {
  if (!env.DB) throw new ClientWorkflowError("Company storage is unavailable.", 503);
  return env.DB;
}
export async function textDigest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function auditStatement(companyId: string, actor: string, action: string, requestId = "") {
  return workflowDb().prepare("INSERT INTO workflow_audit (id, company_id, request_id, actor, action, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), companyId, requestId, actor, action, new Date().toISOString());
}
export async function accessibleCompanyIds(userId: string) {
  const rows = await workflowDb().prepare("SELECT id FROM workflow_companies WHERE owner_id = ? UNION SELECT company_id AS id FROM workflow_members WHERE user_id = ?").bind(userId, userId).all<{ id: string }>();
  return rows.results.map(row => row.id);
}
export async function companyRole(companyId: string, userId: string): Promise<CompanyRole | null> {
  const owner = await workflowDb().prepare("SELECT owner_id FROM workflow_companies WHERE id = ?").bind(companyId).first<{ owner_id: string }>();
  if (!owner) return null;
  if (owner.owner_id === userId) return "admin";
  const member = await workflowDb().prepare("SELECT role FROM workflow_members WHERE company_id = ? AND user_id = ?").bind(companyId, userId).first<{ role: CompanyRole }>();
  return member?.role ?? null;
}
export function requireCompanyRole(role: CompanyRole | null, allowed: CompanyRole[]) {
  if (!role || !allowed.includes(role)) throw new ClientWorkflowError("Your organization role does not permit this action.", 403);
}
export function encryptionReady() { return Boolean((env as unknown as Record<string, string | undefined>).WORKFLOW_ENCRYPTION_KEY); }
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function encryptionKey() {
  const value = (env as unknown as Record<string, string | undefined>).WORKFLOW_ENCRYPTION_KEY;
  if (!value) throw new ClientWorkflowError("Configure the Site WORKFLOW_ENCRYPTION_KEY secret before enabling webhooks.", 503);
  const bytes = decode(value);
  if (bytes.length !== 32) throw new ClientWorkflowError("The Site encryption key must contain 32 random bytes encoded as Base64.", 503);
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function protectCredential(value: string, companyId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(companyId) }, await encryptionKey(), new TextEncoder().encode(value));
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function revealWebhookCredential(companyId: string) {
  const credential = await workflowDb().prepare("SELECT verifier, issued_by FROM workflow_credentials WHERE company_id = ? AND kind = 'webhook'").bind(companyId).first<{ verifier: string; issued_by: string }>();
  if (!credential || await companyRole(companyId, credential.issued_by) !== "admin") throw new ClientWorkflowError("Webhook is not configured or has been revoked.", 401);
  try {
    const [version, nonce, value] = credential.verifier.split(".");
    if (version !== "v1" || !nonce || !value) throw new Error("Invalid envelope");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(nonce), additionalData: new TextEncoder().encode(companyId) }, await encryptionKey(), decode(value));
    return new TextDecoder().decode(plain);
  } catch { throw new ClientWorkflowError("The webhook credential could not be opened. Ask an administrator to rotate it.", 503); }
}
export async function tokenActor(companyId: string, token: string) {
  const row = await workflowDb().prepare("SELECT verifier, issued_by FROM workflow_credentials WHERE company_id = ? AND kind = 'mcp'").bind(companyId).first<{ verifier: string; issued_by: string }>();
  const digest = await textDigest(token);
  if (!row || row.verifier !== digest || !await companyRole(companyId, row.issued_by)) throw new ClientWorkflowError("Invalid or revoked company knowledge token.", 401);
  return row.issued_by;
}
export async function governanceView(companyId: string, ownerId: string) {
  const db = workflowDb();
  const [members, credentials, audit, inbound] = await Promise.all([
    db.prepare("SELECT user_id AS userId, display_name AS displayName, role FROM workflow_members WHERE company_id = ? ORDER BY created_at").bind(companyId).all<CompanyMember>(),
    db.prepare("SELECT kind FROM workflow_credentials WHERE company_id = ?").bind(companyId).all<{ kind: string }>(),
    db.prepare("SELECT id, actor, action, request_id AS requestId, created_at AS createdAt FROM workflow_audit WHERE company_id = ? ORDER BY created_at DESC LIMIT 100").bind(companyId).all<WorkflowAudit>(),
    db.prepare("SELECT created_at FROM workflow_inbound WHERE company_id = ? ORDER BY created_at DESC LIMIT 1").bind(companyId).first<{ created_at: string }>(),
  ]);
  return { members: [{ userId: ownerId, displayName: "Workspace owner", role: "admin" as const, owner: true }, ...members.results], connectors: { webhookConfigured: credentials.results.some(row => row.kind === "webhook"), mcpConfigured: credentials.results.some(row => row.kind === "mcp"), encryptionReady: encryptionReady(), lastInboundAt: inbound?.created_at }, audit: audit.results };
}
