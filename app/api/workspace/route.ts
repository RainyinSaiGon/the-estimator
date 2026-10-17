import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../db";
import { projects as table } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { aiConfig, readBriefWithAI } from "../../../lib/brief-ai";
import { demoScope, estimateProject, getHistory, scopeMatchesBaseline, validateActuals } from "../../../lib/estimator";
import { categories } from "../../../lib/estimator-types";
import type { Project, Workspace } from "../../../lib/estimator-types";
import { normalizeProject } from "../../../lib/project-record";
const driverKeys = ["direction", "api", "quality", "volume", "mapping"] as const;
const historyPolicy = z.enum(["recorded", "demo"]);
const answers = z.object({ direction: z.enum(["unknown", "one-way", "two-way"]), api: z.enum(["unknown", "documented", "custom"]), quality: z.enum(["unknown", "clean", "mixed"]), volume: z.enum(["unknown", "small", "medium", "large"]), mapping: z.enum(["unknown", "standard", "custom"]) });
const identity = { id: z.string().uuid(), expectedUpdatedAt: z.string() };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().trim().min(3).max(120), brief: z.string().trim().min(30).max(20000), mode: z.enum(["openai", "demo"]), historyPolicy: historyPolicy.optional() }),
  z.object({ action: z.literal("review"), ...identity, answers, excluded: z.array(z.enum(categories)).max(8), notes: z.string().max(3000), historyPolicy: historyPolicy.optional(), confirmKeys: z.array(z.enum(driverKeys)).max(5).optional() }),
  z.object({ action: z.literal("freeze"), ...identity, reviewed: z.literal(true), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("complete"), ...identity, hours: z.record(z.enum(categories), z.number().finite().positive().max(10000)), additionalHours: z.number().finite().min(0).max(10000), explanation: z.string().max(3000), synthetic: z.boolean() }),
]);
async function readProjects(owner: string): Promise<Project[]> { return (await getDb().select().from(table).where(eq(table.ownerId, owner)).orderBy(desc(table.updatedAt)).limit(100)).map(r => normalizeProject(JSON.parse(r.payload) as Project)); }
function output(projects: Project[], user: string): Workspace {
  const history = getHistory(projects);
  return { authenticated: true, user, history, aiReady: !!aiConfig().key, projects: projects.map(p => ({ ...p, estimate: estimateProject(p, history.filter(h => h.id !== p.id)) })) };
}
function failure(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const message = error instanceof Error ? error.message : "The request could not be completed.";
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
    const raw = await request.text(); if (raw.length > 30000) throw new Error("This request is too large.");
    const input = schema.parse(JSON.parse(raw)); const projects = await readProjects(user.userId); const at = new Date().toISOString(); let p: Project;
    if (input.action === "create") {
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
