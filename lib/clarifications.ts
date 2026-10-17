import { questions, taskNames } from "./estimator-data.ts";
import { estimateProject } from "./estimator.ts";
import type { Answers, Category, DriverKey, History, Project } from "./estimator-types.ts";

type Input = Pick<Project, "scope" | "answers" | "excluded" | "brief"> & Partial<Pick<Project, "id" | "historyPolicy" | "confirmations">>;
export const driverLabel = (key: DriverKey, value: string) => questions.find(q => q.key === key)?.options.find(([v]) => v === value)?.[1] ?? value;

export function sourceSupport(brief: string, key: DriverKey, value: string): string | null {
  if (value === "unknown") return null;
  const passages = brief.split(/(?<=[.!?])\s+|\n+/).map(p => p.trim()).filter(Boolean);
  return passages.find(p => {
    if (/\b(?:no|not|unconfirmed|pending)\b|n't|have not/i.test(p)) return false;
    if (key === "direction") return value === "one-way" ? /\bone.way|unidirectional|only (?:from|to)\b/i.test(p) : /\btwo.way|bi.?directional|both directions\b/i.test(p);
    if (key === "api") return value === "documented" ? /documented api|api doc(?:umentation|s)/i.test(p) && /access|credentials|available|provided/i.test(p) : /\b(?:build|implement|create|develop|custom|new)\s+(?:(?:a|an|the)\s+)?(?:\w+\s+){0,2}(?:api|endpoints?)\b/i.test(p);
    if (key === "quality") return value === "mixed" ? /duplicat|missing (company|fields|values)|incomplete|dirty/i.test(p) : /clean|validated/i.test(p);
    if (key === "mapping") return value === "standard" ? /standard (?:fields|mapping)|direct mapping/i.test(p) : /custom fields|business rules|transform/i.test(p);
    const m = /\b(\d[\d,]*)\s+(?:existing\s+)?(?:contacts|customers|records|rows)\b/i.exec(p);
    if (!m) return false;
    const n = Number(m[1].replaceAll(",", ""));
    return value === (n < 10000 ? "small" : n <= 100000 ? "medium" : "large");
  }) ?? null;
}

export function questionImpact(project: Input, history: History[]) {
  const sync = project.scope.requirements.some(r => r.id === "sync" && !project.excluded.includes(r.id));
  return questions.map((question, order) => {
    const options = question.options.filter(([v]) => v !== "unknown").map(([value, label]) => {
      const estimate = estimateProject({ ...project, answers: { ...project.answers, [question.key]: value } as Answers }, history);
      return { value, label, hours: estimate.hours, tasks: estimate.tasks };
    });
    const low = Math.min(...options.map(o => o.hours)), high = Math.max(...options.map(o => o.hours));
    const affected = (Object.keys(taskNames) as Category[]).filter(c => new Set(options.map(o => o.tasks.find(t => t.category === c)?.hours ?? 0)).size > 1);
    const unknown = project.answers[question.key] === "unknown";
    const critical = unknown && sync && ["api", "direction"].includes(question.key);
    const support = sourceSupport(project.brief, question.key, project.answers[question.key]);
    const related = question.key === "direction" || question.key === "api" ? ["sync"] : question.key === "quality" ? ["deduplication", "import"] : question.key === "volume" ? ["import"] : ["mapping", "import", "sync"];
    const context = project.scope.requirements.find(r => related.includes(r.id) && project.brief.includes(r.evidence))?.evidence ?? null;
    return { ...question, options, low, high, impact: Math.round((high - low) * 10) / 10, affected, unknown, critical, support, context, order };
  }).sort((a, b) => Number(b.critical) - Number(a.critical) || Number(b.unknown) - Number(a.unknown) || (a.unknown ? b.impact - a.impact : 0) || a.order - b.order);
}

export function clarificationPack(project: Input & { title: string }, history: History[]) {
  const unanswered = questionImpact(project, history).filter(q => q.unknown);
  return `Clarifications for ${project.title}\n\nPlease confirm the following before we agree the scope.\n\n${unanswered.length ? unanswered.map((q, i) => `${i + 1}. ${q.label}${q.critical ? " [needed for a reviewed baseline]" : ""}\n${q.context ? `Context from your brief: “${q.context}”\n` : "The brief does not provide a verified passage for this detail.\n"}Why it matters: ${q.help}\nOptions: ${q.options.map(o => o.label).join("; ")}\nModel sensitivity: ${q.low}–${q.high} person-hours for the whole project, changing only this answer.`).join("\n\n") : "There are no unanswered effort drivers."}\n\nThese are model sensitivities with the other current assumptions held fixed, not a quote or a delivery-date commitment.\n`;
}
