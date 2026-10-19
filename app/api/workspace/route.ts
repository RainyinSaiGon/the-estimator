import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../db";
import { projects as table } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { aiConfig, readBriefWithAI } from "../../../lib/brief-ai";
import { demoScope, estimateProject, getHistory, scopeMatchesBaseline, validateActuals } from "../../../lib/estimator";
import { deterministicHistoryId, historyRowFingerprint, historySourceKey, importedHistoryProject } from "../../../lib/history-import";
import { categories } from "../../../lib/estimator-types";
import type { Project, Workspace } from "../../../lib/estimator-types";
import { normalizeProject } from "../../../lib/project-record";
const driverKeys = ["direction", "api", "quality", "volume", "mapping"] as const;
const historyPolicy = z.enum(["recorded", "demo"]);
const answers = z.object({ direction: z.enum(["unknown", "one-way", "two-way"]), api: z.enum(["unknown", "documented", "custom"]), quality: z.enum(["unknown", "clean", "mixed"]), volume: z.enum(["unknown", "small", "medium", "large"]), mapping: z.enum(["unknown", "standard", "custom"]) });
const identity = { id: z.string().uuid(), expectedUpdatedAt: z.string() };
const importHours = z.object(Object.fromEntries(categories.map(category => [category, z.number().finite().positive().max(10000).optional()]))).strict();
const importRow = z.object({
  line: z.number().int().min(2).max(100000),
  row: z.object({
    sourceId: z.string().max(150).optional(), title: z.string().trim().min(3).max(120),
    baselineAt: z.string().datetime(), completedAt: z.string().datetime(), answers,
    baseline: importHours, actual: importHours,
    rangeLow: z.number().finite().min(0).max(80000).optional(), rangeHigh: z.number().finite().min(0).max(80000).optional(),
    additionalHours: z.number().finite().min(0).max(10000), additionalNotes: z.string().max(3000),
  }).superRefine((row, ctx) => {
    if (Date.parse(row.baselineAt) > Date.parse(row.completedAt)) ctx.addIssue({ code: "custom", path: ["baselineAt"], message: "Baseline date must be on or before delivery date." });
    const baseKeys = categories.filter(category => row.baseline[category] !== undefined);
    const actualKeys = categories.filter(category => row.actual[category] !== undefined);
    if (!baseKeys.length) ctx.addIssue({ code: "custom", path: ["baseline"], message: "Provide at least one task baseline." });
    for (const category of categories) if ((row.baseline[category] !== undefined) !== (row.actual[category] !== undefined)) ctx.addIssue({ code: "custom", path: ["actual", category], message: "Baseline and actual task hours must both be filled or both be blank." });
    if (baseKeys.length !== actualKeys.length) ctx.addIssue({ code: "custom", path: ["actual"], message: "Baseline and actual task categories must match." });
    if ((row.rangeLow === undefined) !== (row.rangeHigh === undefined)) ctx.addIssue({ code: "custom", path: ["rangeLow"], message: "Provide both range values or leave both blank." });
    const total = Object.values(row.baseline).reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (row.rangeLow !== undefined && row.rangeHigh !== undefined && (row.rangeLow > total || row.rangeHigh < total || row.rangeLow > row.rangeHigh)) ctx.addIssue({ code: "custom", path: ["rangeLow"], message: "The original range must contain the total task baseline estimate." });
    if (row.additionalHours > 0 && row.additionalNotes.trim().length < 10) ctx.addIssue({ code: "custom", path: ["additionalNotes"], message: "Explain added work in at least 10 characters when added-scope hours are nonzero." });
  }),
});
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().trim().min(3).max(120), brief: z.string().trim().min(30).max(20000), mode: z.enum(["openai", "demo"]), historyPolicy: historyPolicy.optional() }),
  z.object({ action: z.literal("review"), ...identity, answers, excluded: z.array(z.enum(categories)).max(8), notes: z.string().max(3000), historyPolicy: historyPolicy.optional(), confirmKeys: z.array(z.enum(driverKeys)).max(5).optional() }),
  z.object({ action: z.literal("freeze"), ...identity, reviewed: z.literal(true), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("complete"), ...identity, hours: z.record(z.enum(categories), z.number().finite().positive().max(10000)), additionalHours: z.number().finite().min(0).max(10000), explanation: z.string().max(3000), synthetic: z.boolean() }),
  z.object({ action: z.literal("importHistory"), sourceFile: z.string().trim().min(1).max(120), records: z.array(importRow).min(1).max(25) }),
]);
async function readProjects(owner: string): Promise<Project[]> { return (await getDb().select().from(table).where(eq(table.ownerId, owner)).orderBy(desc(table.updatedAt)).limit(100)).map(r => normalizeProject(JSON.parse(r.payload) as Project)); }
function output(projects: Project[], user: string): Workspace {
  const history = getHistory(projects);
  return { authenticated: true, user, history, aiReady: !!aiConfig().key, projects: projects.map(p => ({ ...p, estimate: estimateProject(p, history.filter(h => h.id !== p.id)) })) };
}
function failure(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  if (/^Failed query:/i.test(message)) return Response.json({ error: "Your workspace is temporarily unavailable. Please try again shortly." }, { status: 503 });
  if (/no such table|binding.*unavailable/i.test(message)) return Response.json({ error: "Project storage is not ready. Apply the database migration." }, { status: 503 });
  return Response.json({ error: message }, { status: 400 });
}
export async function GET() {
  const user = await getChatGPTUser(); if (!user) return Response.json({ error: "Sign in to open your workspace." }, { status: 401 });
  try { return Response.json(output(await readProjects(user.userId), user.displayName), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser(); if (!user) return Response.json({ error: "Sign in to save your work." }, { status: 401 });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "This request must come from your workspace." }, { status: 403 });
  try {
    const raw = await request.text(); const rawBytes = new TextEncoder().encode(raw).byteLength;
    if (rawBytes > 600000) throw new Error("This request is too large.");
    const parsed = JSON.parse(raw) as { action?: string };
    if (parsed.action !== "importHistory" && rawBytes > 30000) throw new Error("This request is too large.");
    const input = schema.parse(parsed); const projects = await readProjects(user.userId); const at = new Date().toISOString(); let p: Project;
    if (input.action === "importHistory") {
      const sourceFile = input.sourceFile.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 120);
      const known = new Set(projects.map(project => project.importProvenance?.fingerprint).filter((value): value is string => !!value));
      const knownSourceIds = new Set(projects.flatMap(project => project.importProvenance?.sourceId ? [historySourceKey(project.importProvenance.sourceFile, project.importProvenance.sourceId)] : []));
      const seen = new Set<string>();
      const seenSourceIds = new Set<string>();
      const additions: Project[] = [];
      let skipped = 0;
      for (const item of input.records) {
        const fingerprint = await historyRowFingerprint(item.row);
        const sourceKey = item.row.sourceId ? historySourceKey(sourceFile, item.row.sourceId) : undefined;
        if (known.has(fingerprint) || seen.has(fingerprint) || sourceKey && (knownSourceIds.has(sourceKey) || seenSourceIds.has(sourceKey))) { skipped++; continue; }
        seen.add(fingerprint);
        if (sourceKey) seenSourceIds.add(sourceKey);
        const id = await deterministicHistoryId(user.userId, fingerprint);
        additions.push(importedHistoryProject(item.row, id, sourceFile, item.line, fingerprint, at));
      }
      if (projects.length + additions.length > 100) throw new Error("This workspace can hold up to 100 requests and imported delivery records.");
      if (additions.length) {
        const values = additions.map(project => ({ id: project.id, ownerId: user.userId, payload: JSON.stringify(project), updatedAt: project.updatedAt }));
        await getDb().insert(table).values(values);
      }
      const updated = additions.length ? [...additions, ...projects] : projects;
      return Response.json({ ...output(updated, user.displayName), importedCount: additions.length, skippedCount: skipped }, { headers: { "Cache-Control": "no-store" } });
    } else if (input.action === "create") {
      if (projects.length >= 100) throw new Error("This MVP supports 100 requests per workspace.");
      const scope = input.mode === "openai" ? await readBriefWithAI(input.brief) : demoScope(input.brief);
      p = { schemaVersion: 2, id: crypto.randomUUID(), title: input.title, brief: input.brief, scope, answers: scope.initialAnswers, excluded: [], notes: "", versions: [], actuals: null, createdAt: at, updatedAt: at, historyPolicy: input.historyPolicy ?? (input.mode === "demo" ? "demo" : "recorded"), confirmations: {} };
    } else {
      const found = projects.find(p => p.id === input.id); if (!found) return Response.json({ error: "Project not found." }, { status: 404 });
      if (input.expectedUpdatedAt !== found.updatedAt) return Response.json({ error: "This request changed in another session. Refresh before saving." }, { status: 409 });
      p = { ...found, updatedAt: at }; if (p.actuals) throw new Error("Delivery is complete. Create a new request to estimate more work.");
      if (input.action === "review") {
        if (input.excluded.some(c => !p.scope.requirements.some(r => r.id === c))) throw new Error("Only requested deliverables can be excluded from the scope.");
        p.confirmations = { ...p.confirmations };
        for (const key of driverKeys) {
          if (input.answers[key] === "unknown") delete p.confirmations[key];
          else if (input.answers[key] !== p.answers[key] || input.confirmKeys?.includes(key)) p.confirmations[key] = { value: input.answers[key], at, notes: input.notes.trim() };
        }
        p.answers = input.answers; p.excluded = [...new Set(input.excluded)]; p.notes = input.notes.trim(); p.historyPolicy = input.historyPolicy ?? p.historyPolicy;
      }
      const estimate = estimateProject(p, getHistory(projects).filter(h => h.id !== p.id));
      if (input.action === "freeze") {
        if (estimate.blockers.length) throw new Error("Resolve the critical questions before saving a baseline.");
        if (p.versions.length >= 20) throw new Error("This MVP supports 20 baseline versions per request.");
        if (p.versions.length && (!input.reason || input.reason.length < 10)) throw new Error("Explain the replacement baseline in at least 10 characters.");
        p.versions = [...p.versions, { id: crypto.randomUUID(), revision: p.versions.length + 1, at, estimate, answers: { ...p.answers }, excluded: [...p.excluded], notes: p.notes, historyPolicy: p.historyPolicy, confirmations: { ...p.confirmations }, reason: input.reason || "Initial reviewed estimate" }];
      }
      if (input.action === "complete") {
        const baseline = p.versions.at(-1); if (!baseline) throw new Error("Save a reviewed estimate before recording delivery hours.");
        if (!scopeMatchesBaseline(p)) throw new Error("The scope changed. Save a new baseline before recording actual hours.");
        const actuals = { hours: input.hours, additionalHours: input.additionalHours, explanation: input.explanation.trim(), synthetic: input.synthetic, at }; validateActuals(baseline.estimate, actuals); p.actuals = actuals;
      }
    }
    const values = { id: p.id, ownerId: user.userId, payload: JSON.stringify(p), updatedAt: p.updatedAt };
    if (input.action === "create") await getDb().insert(table).values(values);
    else { const updated = await getDb().update(table).set(values).where(and(eq(table.id, p.id), eq(table.ownerId, user.userId), eq(table.updatedAt, input.expectedUpdatedAt))).returning({ id: table.id }); if (!updated.length) return Response.json({ error: "The request changed while saving. Refresh and retry." }, { status: 409 }); }
    return Response.json({ ...output([p, ...projects.filter(x => x.id !== p.id)], user.displayName), selectedId: p.id }, { status: input.action === "create" ? 201 : 200 });
  } catch (e) { return failure(e); }
}
