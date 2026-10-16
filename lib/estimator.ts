import { baseHours, emptyAnswers, seedHistory, taskNames } from "./estimator-data.ts";
import { categories } from "./estimator-types.ts";
import type { Actuals, Answers, Category, Estimate, History, Project, Scope } from "./estimator-types.ts";
const round = (n: number) => Math.round(n * 10) / 10;
function median(values: number[]) { const a = [...values].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
export function demoScope(brief: string): Scope {
  if (brief.trim().length < 30 || brief.length > 20000) throw new Error("Use a brief between 30 and 20,000 characters.");
  const lines = brief.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const evidence = (pattern: RegExp) => lines.find(s => pattern.test(s)) ?? "";
  const migration = evidence(/\b(csv|migrat\w*|import\w*|historical|legacy)\b/i);
  const sync = evidence(/\b(sync\w*|nightly|every night|integrat\w*|connect\w*)\b/i);
  const dedup = evidence(/\b(duplicat\w*|dedup\w*|reconcil\w*)\b/i);
  if (!migration && !sync) throw new Error("This MVP supports data imports and CRM / API integrations. Describe the import or integration you need.");
  const initialAnswers = { ...emptyAnswers };
  if (/two.way|bi.?directional|both directions/i.test(brief)) initialAnswers.direction = "two-way";
  else if (/one.way|unidirectional/i.test(brief)) initialAnswers.direction = "one-way";
  if (/duplicat|missing (company|fields|values)|incomplete|dirty/i.test(brief)) initialAnswers.quality = "mixed";
  const match = /\b(\d[\d,]*)\s+(?:existing\s+)?(?:contacts|customers|records|rows)\b/i.exec(brief);
  if (match) { const n = Number(match[1].replaceAll(",", "")); initialAnswers.volume = n < 10000 ? "small" : n <= 100000 ? "medium" : "large"; }
  const requirements: Scope["requirements"] = [
    { id: "mapping", title: "Map records to destination fields", evidence: migration || sync },
    ...(migration ? [{ id: "import" as const, title: "Import historical records", evidence: migration }] : []),
    ...(sync ? [{ id: "sync" as const, title: "Connect systems and synchronize updates", evidence: sync }] : []),
    ...(dedup ? [{ id: "deduplication" as const, title: "Detect duplicates and reconcile records", evidence: dedup }] : []),
  ];
  return { summary: "Deliver a reliable connection between client systems and clean, reusable customer data.", requirements, initialAnswers, risks: ["Acceptance criteria and field mappings need delivery review.", "The client's requested date is a constraint, not a confirmed delivery commitment."], parser: "demo" };
}
export function similarity(a: Answers, b: Answers) {
  const weights = { direction: 3, api: 3, quality: 2, volume: 1, mapping: 2 }; let matched = 0, known = 0;
  for (const k of Object.keys(weights) as (keyof Answers)[]) if (a[k] !== "unknown") { known += weights[k]; if (a[k] === b[k]) matched += weights[k]; }
  return known ? matched / known : 0;
}
export function estimateProject(project: Pick<Project, "scope" | "answers" | "excluded">, history: History[]): Estimate {
  const a = project.answers;
  const included = new Set<Category>(["discovery", "mapping", "testing", "handover", ...project.scope.requirements.map(r => r.id)]);
  const syncIncluded = included.has("sync") && !project.excluded.includes("sync");
  if (syncIncluded) included.add("authentication");
  for (const c of project.excluded) included.delete(c);
  const bases = { ...baseHours, authentication: a.api === "custom" ? 20 : 8, mapping: a.mapping === "custom" ? 18 : 10, sync: a.direction === "two-way" ? 30 : 16, deduplication: a.quality === "mixed" ? 12 : 8, testing: syncIncluded && a.direction === "two-way" ? 18 : 12 };
  if (a.quality === "mixed") bases.import *= 1.4;
  if (a.volume === "large") { bases.import *= 1.6; bases.testing *= 1.25; }
  if (a.volume === "small") bases.import *= 0.75;
  const unknown = Object.values(a).filter(v => v === "unknown").length;
  const ranked = history.map(h => ({ ...h, score: similarity(a, h.features) })).sort((x, y) => y.score - x.score);
  const tasks = categories.filter(c => included.has(c)).map(category => {
    const comparable = ranked.filter(h => h.score >= 0.45 && (h.base[category] ?? 0) > 0 && Number.isFinite(h.actual[category]) && (h.actual[category] ?? 0) > 0);
    const ratios = comparable.map(h => Math.max(0.35, Math.min(3, h.actual[category]! / h.base[category]!)));
    const support = ratios.length / (ratios.length + 4);
    const factor = ratios.length ? 1 + support * (median(ratios) - 1) : 1;
    const hours = round(bases[category] * factor);
    const spread = ratios.length > 1 ? Math.max(...ratios) - Math.min(...ratios) : 0.4;
    return { category, label: taskNames[category], base: round(bases[category]), factor: Math.round(factor * 100) / 100, hours, low: Math.floor(hours * Math.max(0.65, 0.85 - unknown * 0.025)), high: Math.ceil(hours * (1.18 + unknown * 0.075 + Math.min(0.35, spread / 3) + (ratios.length < 3 ? 0.12 : 0))), observations: ratios.length };
  });
  const blockers = [];
  if (project.scope.requirements.every(r => project.excluded.includes(r.id))) blockers.push("Include at least one requested deliverable in the scope.");
  if (syncIncluded && a.direction === "unknown") blockers.push("Confirm the direction of synchronization.");
  if (syncIncluded && a.api === "unknown") blockers.push("Confirm API documentation and access, or include custom API work.");
  const assumptions = ["Effort is in person-hours. Elapsed delivery time depends on team availability.", "Discovery, testing and handover are delivery work included in the estimate."];
  if (a.mapping === "unknown") assumptions.push("Field mapping is provisionally standard; custom business rules are unconfirmed.");
  if (a.quality === "unknown") assumptions.push("Source data quality has not been assessed.");
  if (a.volume === "unknown") assumptions.push("Record volume is unconfirmed.");
  return { tasks, hours: round(tasks.reduce((s, t) => s + t.hours, 0)), baseHours: round(tasks.reduce((s, t) => s + t.base, 0)), low: tasks.reduce((s, t) => s + t.low, 0), high: tasks.reduce((s, t) => s + t.high, 0), blockers, assumptions,
    references: ranked.filter(h => h.score >= 0.45).slice(0, 3).map(h => ({ id: h.id, name: h.name, synthetic: h.synthetic, score: h.score, hours: round(Object.values(h.actual).reduce((s, n) => s + (n ?? 0), 0)) })) };
}
export function getHistory(projects: Project[]): History[] {
  return [...seedHistory, ...projects.filter(p => p.actuals && p.versions.length).map(p => {
    const v = p.versions.at(-1)!;
    return { id: p.id, name: p.title, synthetic: p.actuals!.synthetic, features: v.answers, base: Object.fromEntries(v.estimate.tasks.map(t => [t.category, t.base])), actual: { ...p.actuals!.hours } };
  })];
}
export function validateActuals(estimate: Estimate, actuals: Actuals) {
  const included = new Set<string>(estimate.tasks.map(t => t.category));
  if (Object.keys(actuals.hours).some(c => !included.has(c))) throw new Error("Record hours only for baseline tasks; put added work in additional scope.");
  for (const task of estimate.tasks) { const n = actuals.hours[task.category]; if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 10000) throw new Error(`Enter original-scope hours greater than 0 and at most 10,000 for ${task.label}.`); }
  if (!Number.isFinite(actuals.additionalHours) || actuals.additionalHours < 0 || actuals.additionalHours > 10000) throw new Error("Additional scope must be between 0 and 10,000 hours.");
  if (actuals.additionalHours > 0 && actuals.explanation.trim().length < 10) throw new Error("Describe the added scope in at least 10 characters.");
}
export function scopeMatchesBaseline(p: Project) {
  const b = p.versions.at(-1);
  return !!b && JSON.stringify(b.answers) === JSON.stringify(p.answers) && JSON.stringify([...b.excluded].sort()) === JSON.stringify([...p.excluded].sort()) && b.notes === p.notes;
}
