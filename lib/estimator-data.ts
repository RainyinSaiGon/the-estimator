import type { Answers, Category, History } from "./estimator-types.ts";
export const emptyAnswers: Answers = { direction: "unknown", api: "unknown", quality: "unknown", volume: "unknown", mapping: "unknown" };
export const taskNames: Record<Category, string> = { discovery: "Discovery & acceptance criteria", authentication: "API connection & authentication", mapping: "Field mapping & transformation", import: "Historical data import", sync: "Scheduled synchronization", deduplication: "Duplicates & reconciliation", testing: "Testing & failure recovery", handover: "Deployment & handover" };
export const sampleBrief = `Hi team,

We need to connect our HubSpot CRM to our customer portal. Please import 15,000 existing contacts from a CSV file and sync contact changes every night.

Some records are duplicated or missing company names. We need duplicate detection so we don't create a second customer when the email already exists.

The portal has a REST API, but we haven't shared its documentation yet. We'd like this live in two weeks. Can you tell us what's involved and how much effort it will take?

Thanks,
Maya · Operations Lead`;
export const baseHours: Record<Category, number> = { discovery: 5, authentication: 8, mapping: 10, import: 12, sync: 16, deduplication: 8, testing: 12, handover: 6 };
const seeds = [
  ["Northstar · contact sync", "one-way", "documented", "clean", "medium", "standard", 1.04],
  ["Lumen · customer migration", "one-way", "documented", "mixed", "medium", "standard", 1.18],
  ["Atlas · CRM integration", "two-way", "documented", "mixed", "medium", "custom", 1.29],
  ["Acorn · contact import", "one-way", "documented", "clean", "small", "standard", 0.93],
  ["Cedar · legacy migration", "one-way", "custom", "mixed", "large", "custom", 1.31],
  ["Orbit · nightly sync", "one-way", "documented", "mixed", "medium", "standard", 1.13],
  ["Fable · CRM migration", "one-way", "documented", "mixed", "small", "standard", 1.09],
  ["Meridian · two-way sync", "two-way", "custom", "clean", "large", "custom", 1.22],
] as const;
export const seedHistory: History[] = seeds.map((r, i) => ({ id: `sample-${i + 1}`, name: r[0], synthetic: true,
  features: { direction: r[1], api: r[2], quality: r[3], volume: r[4], mapping: r[5] }, base: { ...baseHours },
  actual: Object.fromEntries(Object.entries(baseHours).map(([c, n]) => [c, Math.round(n * r[6] * (c === "import" && r[3] === "mixed" ? 1.35 : c === "testing" ? 1.15 : 1) * 10) / 10])),
}));
export const questions: { key: keyof Answers; label: string; help: string; options: [string, string][] }[] = [
  { key: "direction", label: "Which way does the data flow?", help: "Two-way sync adds conflict resolution and more testing.", options: [["unknown", "Needs clarification"], ["one-way", "CRM → destination only"], ["two-way", "Both directions"]] },
  { key: "api", label: "Is the destination API ready?", help: "Confirm documentation and access before committing.", options: [["unknown", "Not confirmed"], ["documented", "Documented API, access available"], ["custom", "Custom API work required"]] },
  { key: "quality", label: "How clean is the source data?", help: "Cleanup and reconciliation can drive migration effort.", options: [["unknown", "Not assessed"], ["clean", "Clean and validated"], ["mixed", "Duplicates or incomplete records"]] },
  { key: "volume", label: "How many records are involved?", help: "Volume affects batching, recovery and reconciliation.", options: [["unknown", "Not confirmed"], ["small", "Under 10,000"], ["medium", "10,000–100,000"], ["large", "Over 100,000"]] },
  { key: "mapping", label: "How complex is the field mapping?", help: "Custom transformations need additional implementation and tests.", options: [["unknown", "Fields not confirmed"], ["standard", "Standard fields, direct mapping"], ["custom", "Custom fields or business rules"]] },
];
