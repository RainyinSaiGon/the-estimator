import type { Project } from "./estimator-types.ts";

/** Default live fields while retaining saved snapshot fields and values. */
export function normalizeProject(value: Project): Project {
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2) throw new Error("This request uses an unsupported data version.");
  return { ...value, schemaVersion: 2, historyPolicy: value.historyPolicy ?? "demo", confirmations: value.confirmations ?? {} };
}
