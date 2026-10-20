import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  payload: text("payload").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("projects_owner_updated").on(t.ownerId, t.updatedAt)]);

export const workflowCompanies = sqliteTable("workflow_companies", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("workflow_companies_owner_updated").on(t.ownerId, t.updatedAt)]);

export const workflowRequests = sqliteTable("workflow_requests", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  companyId: text("company_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull().default(1),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("workflow_requests_owner_company_updated").on(t.ownerId, t.companyId, t.updatedAt),
  index("workflow_requests_company_status").on(t.companyId, t.status),
]);

export const workflowMembers = sqliteTable("workflow_members", {
  companyId: text("company_id").notNull(), userId: text("user_id").notNull(), displayName: text("display_name").notNull(), role: text("role").notNull(), createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.companyId, t.userId] }), index("workflow_members_user").on(t.userId, t.companyId)]);
export const workflowCredentials = sqliteTable("workflow_credentials", {
  companyId: text("company_id").notNull(), kind: text("kind").notNull(), verifier: text("verifier").notNull(), issuedBy: text("issued_by").notNull(), createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.companyId, t.kind] })]);
export const workflowInbound = sqliteTable("workflow_inbound", {
  companyId: text("company_id").notNull(), submissionId: text("submission_id").notNull(), payloadDigest: text("payload_digest").notNull(), requestId: text("request_id").notNull(), createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.companyId, t.submissionId] })]);
export const workflowAudit = sqliteTable("workflow_audit", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull(), requestId: text("request_id").notNull(), actor: text("actor").notNull(), action: text("action").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("workflow_audit_company").on(t.companyId, t.createdAt)]);

export const workflowExportSnapshots = sqliteTable("workflow_export_snapshots", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull(), createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(),
}, t => [index("workflow_export_snapshots_company_expiry").on(t.companyId, t.expiresAt)]);
export const workflowExportSnapshotItems = sqliteTable("workflow_export_snapshot_items", {
  snapshotId: text("snapshot_id").notNull(), requestId: text("request_id").notNull(), payload: text("payload").notNull(),
}, t => [primaryKey({ columns: [t.snapshotId, t.requestId] })]);
export const workflowObjectDeletions = sqliteTable("workflow_object_deletions", {
  objectKey: text("object_key").primaryKey(), attempts: integer("attempts").notNull().default(0), availableAt: text("available_at").notNull(), createdAt: text("created_at").notNull(), lastError: text("last_error"),
}, t => [index("workflow_object_deletions_due").on(t.availableAt, t.createdAt)]);
