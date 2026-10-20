import { env } from "cloudflare:workers";
import { workflowDb } from "./workflow-governance";
import { r2CleanupRetryDelayMs } from "./r2-object-cleanup-policy";

const ORPHAN_UPLOAD_GRACE_MS = 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 25;

type CleanupRow = { object_key: string; attempts: number };

export async function stageR2ObjectCleanup(objectKey: string, now = new Date()) {
  const createdAt = now.toISOString();
  const availableAt = new Date(now.getTime() + ORPHAN_UPLOAD_GRACE_MS).toISOString();
  await workflowDb().prepare(`
    INSERT INTO workflow_object_deletions (object_key, attempts, available_at, created_at)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(object_key) DO UPDATE SET available_at = MIN(workflow_object_deletions.available_at, excluded.available_at)
  `).bind(objectKey, availableAt, createdAt).run();
}

export async function activateR2ObjectCleanup(objectKeys: string[], now = new Date()) {
  const keys = [...new Set(objectKeys)];
  if (!keys.length) return;
  const db = workflowDb();
  await db.batch(keys.map((key) => db.prepare(`
    UPDATE workflow_object_deletions SET available_at = ?, last_error = NULL WHERE object_key = ?
  `).bind(now.toISOString(), key)));
}

export async function drainR2ObjectCleanup(limit = DEFAULT_BATCH_SIZE) {
  const database = workflowDb();
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!bucket) return { attempted: 0, deleted: 0, deferred: 0 };
  const now = new Date();
  const nowIso = now.toISOString();
  const batchSize = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : DEFAULT_BATCH_SIZE;
  const due = await database.prepare(`
    SELECT object_key, attempts FROM workflow_object_deletions
    WHERE available_at <= ? ORDER BY available_at, created_at LIMIT ?
  `).bind(nowIso, batchSize).all<CleanupRow>();
  let deleted = 0;
  let deferred = 0;
  for (const row of due.results) {
    try {
      await bucket.delete(row.object_key);
    } catch (error) {
      const attempts = row.attempts + 1;
      const delay = r2CleanupRetryDelayMs(attempts);
      const nextAttempt = new Date(now.getTime() + delay).toISOString();
      const errorType = error instanceof Error ? error.name.slice(0, 80) : "UnknownError";
      await database.prepare(`
        UPDATE workflow_object_deletions
        SET attempts = attempts + 1, available_at = ?, last_error = ?
        WHERE object_key = ?
      `).bind(nextAttempt, errorType, row.object_key).run();
      deferred++;
      continue;
    }
    // R2 deletes are idempotent. If this acknowledgement fails, the next run
    // safely repeats the delete and removes the durable job afterwards.
    await database.prepare("DELETE FROM workflow_object_deletions WHERE object_key = ?").bind(row.object_key).run();
    deleted++;
  }
  return { attempted: due.results.length, deleted, deferred };
}
