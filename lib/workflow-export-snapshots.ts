import type { DeliveryEvaluation } from "./client-workflow-types";
import { ClientWorkflowError } from "./workflow-errors";
import { createDeliveryEvaluationAccumulator, type DeliveryRecord } from "./workflow-evaluation";
import { requireReadableCompany } from "./workflow-queries";
import { workflowDb } from "./workflow-governance";

const EXPORT_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_COMPANY = 3;
const EXPORT_PAGE_SIZE = 25;

type SnapshotRow = { request_id: string; payload: string };

async function createSnapshot(companyId: string) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + EXPORT_SNAPSHOT_TTL_MS).toISOString();
  const db = workflowDb();
  const result = await db.batch([
    db.prepare("DELETE FROM workflow_export_snapshot_items WHERE snapshot_id IN (SELECT id FROM workflow_export_snapshots WHERE expires_at <= ?)").bind(createdAt),
    db.prepare("DELETE FROM workflow_export_snapshots WHERE expires_at <= ?").bind(createdAt),
    db.prepare(`INSERT INTO workflow_export_snapshots (id, company_id, created_at, expires_at)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM workflow_export_snapshots WHERE company_id = ? AND expires_at > ?) < ?`)
      .bind(id, companyId, createdAt, expiresAt, companyId, createdAt, MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_COMPANY),
    // The header insert is conditional on the per-company cap. Do not leave
    // orphan rows behind when that insert is rejected.
    db.prepare(`INSERT INTO workflow_export_snapshot_items (snapshot_id, request_id, payload)
      SELECT ?, request.id, json_object(
        'id', request.id,
        'channel', json_extract(request.payload, '$.channel'),
        'cohort', COALESCE(json_extract(request.payload, '$.cohort'), 'synthetic'),
        'createdAt', json_extract(request.payload, '$.createdAt'),
        'createdBy', json_extract(request.payload, '$.createdBy'),
        'baselines', json(COALESCE(json_extract(request.payload, '$.baselines'), '[]')),
        'delivery', json(COALESCE(json_extract(request.payload, '$.delivery'), '[]'))
      ) FROM workflow_requests AS request
      WHERE request.company_id = ? AND EXISTS (SELECT 1 FROM workflow_export_snapshots WHERE id = ?)
      ORDER BY request.id`)
      .bind(id, companyId, id),
  ]);
  if (result[2].meta.changes !== 1)
    throw new ClientWorkflowError("This workspace already has several exports in progress. Retry after one finishes.", 429);
  return id;
}

async function* snapshotRequests(snapshotId: string): AsyncGenerator<DeliveryRecord> {
  let after = "";
  while (true) {
    const rows = await workflowDb().prepare(`
      SELECT request_id, payload FROM workflow_export_snapshot_items
      WHERE snapshot_id = ? AND request_id > ? ORDER BY request_id LIMIT ?
    `).bind(snapshotId, after, EXPORT_PAGE_SIZE).all<SnapshotRow>();
    for (const row of rows.results) {
      after = row.request_id;
      yield JSON.parse(row.payload) as DeliveryRecord;
    }
    if (rows.results.length < EXPORT_PAGE_SIZE) return;
  }
}

async function deleteSnapshot(snapshotId: string) {
  const db = workflowDb();
  await db.batch([
    db.prepare("DELETE FROM workflow_export_snapshot_items WHERE snapshot_id = ?").bind(snapshotId),
    db.prepare("DELETE FROM workflow_export_snapshots WHERE id = ?").bind(snapshotId),
  ]);
}

export async function createCompanyRecordsExport(actorId: string, companyId: string) {
  await requireReadableCompany(actorId, companyId);
  const snapshotId = await createSnapshot(companyId);
  const records = snapshotRequests(snapshotId);
  let closed = false;
  return {
    records,
    async close() {
      if (closed) return;
      closed = true;
      try { await records.return(undefined); } finally { await deleteSnapshot(snapshotId); }
    },
  };
}

export async function completeCompanyEvaluation(actorId: string, companyId: string): Promise<DeliveryEvaluation> {
  const snapshot = await createCompanyRecordsExport(actorId, companyId);
  const accumulator = createDeliveryEvaluationAccumulator();
  try {
    for await (const request of snapshot.records) accumulator.add(request);
    return accumulator.result();
  } finally {
    await snapshot.close();
  }
}
