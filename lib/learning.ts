import type { Project } from "./estimator-types.ts";

export function learningReport(projects: Project[], synthetic: boolean) {
  let excluded = 0;
  const rows = projects.flatMap(p => {
    const a = p.actuals, b = p.versions.at(-1);
    if (!a || !b || a.synthetic !== synthetic) return [];
    if (!Number.isFinite(Date.parse(b.at)) || !Number.isFinite(Date.parse(a.at)) || Date.parse(b.at) > Date.parse(a.at) || b.estimate.tasks.some(t => !Number.isFinite(a.hours[t.category]) || (a.hours[t.category] ?? 0) <= 0)) { excluded++; return []; }
    const actual = b.estimate.tasks.reduce((sum, t) => sum + (a.hours[t.category] ?? 0), 0);
    if (!Number.isFinite(actual) || actual <= 0 || !Number.isFinite(b.estimate.hours) || !Number.isFinite(b.estimate.baseHours)) { excluded++; return []; }
    const baseError = Math.abs(b.estimate.baseHours - actual), adjustedError = Math.abs(b.estimate.hours - actual);
    return [{ id: p.id, name: p.title, revision: b.revision, base: b.estimate.baseHours, adjusted: b.estimate.hours, actual, baseError, adjustedError, bias: b.estimate.hours - actual, covered: actual >= b.estimate.low && actual <= b.estimate.high, added: a.additionalHours, provenanceKnown: !!b.estimate.provenance, policy: b.historyPolicy ?? b.estimate.provenance?.historyPolicy ?? null }];
  });
  const n = rows.length;
  const mean = (key: "baseError" | "adjustedError" | "bias") => n ? rows.reduce((sum, r) => sum + r[key], 0) / n : null;
  return { rows, n, excluded, baseMAE: mean("baseError"), adjustedMAE: mean("adjustedError"), bias: mean("bias"), coverage: n ? rows.filter(r => r.covered).length / n : null, covered: rows.filter(r => r.covered).length };
}
