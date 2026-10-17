import { categories } from "./estimator-types.ts";
import { taskNames } from "./estimator-data.ts";
import type { Answers, Category, Estimate, Project } from "./estimator-types.ts";

export const MAX_HISTORY_IMPORT_ROWS = 25;
export const MAX_HISTORY_CSV_BYTES = 250_000;

export type HistoryImportField =
  | "sourceId" | "title" | "baselineAt" | "completedAt"
  | "direction" | "api" | "quality" | "volume" | "mapping"
  | "rangeLow" | "rangeHigh" | "additionalHours" | "additionalNotes"
  | `baseline:${Category}` | `actual:${Category}`;

export const historyImportFields: { key: HistoryImportField; label: string; header: string; required: boolean }[] = [
  { key: "sourceId", label: "Source record ID", header: "source_id", required: false },
  { key: "title", label: "Project name", header: "project_name", required: true },
  { key: "baselineAt", label: "Baseline date", header: "baseline_at", required: true },
  { key: "completedAt", label: "Delivery date", header: "completed_at", required: true },
  { key: "direction", label: "Data flow direction", header: "direction", required: true },
  { key: "api", label: "API readiness", header: "api", required: true },
  { key: "quality", label: "Source data quality", header: "quality", required: true },
  { key: "volume", label: "Record volume", header: "volume", required: true },
  { key: "mapping", label: "Mapping complexity", header: "mapping", required: true },
  ...categories.flatMap(category => [
    { key: `baseline:${category}` as const, label: `Baseline · ${category}`, header: `baseline_${category}_hours`, required: true },
    { key: `actual:${category}` as const, label: `Actual · ${category}`, header: `actual_${category}_hours`, required: true },
  ]),
  { key: "rangeLow", label: "Original range low (total hours)", header: "range_low_hours", required: false },
  { key: "rangeHigh", label: "Original range high (total hours)", header: "range_high_hours", required: false },
  { key: "additionalHours", label: "Added-scope hours", header: "additional_hours", required: true },
  { key: "additionalNotes", label: "Added-scope explanation", header: "additional_scope_notes", required: false },
];

export type ParsedCsv = { headers: string[]; rows: { line: number; cells: string[] }[] };
export type HistoryImportRow = {
  sourceId?: string;
  title: string;
  baselineAt: string;
  completedAt: string;
  answers: Answers;
  baseline: Partial<Record<Category, number>>;
  actual: Partial<Record<Category, number>>;
  rangeLow?: number;
  rangeHigh?: number;
  additionalHours: number;
  additionalNotes: string;
};
export type MappedHistoryRow = { line: number; row?: HistoryImportRow; errors: string[]; fingerprint?: string; duplicate?: boolean };

export function parseHistoryCsv(text: string): ParsedCsv {
  if (new TextEncoder().encode(text).byteLength > MAX_HISTORY_CSV_BYTES) throw new Error("CSV files must be 250 KB or smaller.");
  const source = text.replace(/^\uFEFF/, "");
  const matrix: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, afterQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else cell += char;
      continue;
    }
    if (afterQuote && char !== "," && char !== "\n" && char !== "\r") throw new Error(`Unexpected character after a quoted field near line ${matrix.length + 1}.`);
    if (char === '"') {
      if (cell.length) throw new Error(`Unexpected quote near line ${matrix.length + 1}.`);
      quoted = true;
      afterQuote = false;
    } else if (char === ",") { row.push(cell); cell = ""; afterQuote = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); matrix.push(row); row = []; cell = ""; afterQuote = false;
    } else cell += char;
  }
  if (quoted) throw new Error("The CSV ends inside a quoted field.");
  if (cell.length || row.length) { row.push(cell); matrix.push(row); }
  while (matrix.length && matrix.at(-1)!.every(value => !value.trim())) matrix.pop();
  if (matrix.length < 2) throw new Error("Choose a CSV with a header and at least one delivery row.");
  const headers = matrix[0].map(value => value.trim());
  if (headers.length > 64 || headers.some(value => !value)) throw new Error("CSV headers must be non-empty, with no more than 64 columns.");
  if (new Set(headers.map(value => value.toLocaleLowerCase())).size !== headers.length) throw new Error("CSV headers must be unique, ignoring letter case.");
  const rows = matrix.slice(1).map((cells, index) => ({ line: index + 2, cells })).filter(({ cells }) => cells.some(value => value.trim()));
  if (rows.length > MAX_HISTORY_IMPORT_ROWS) throw new Error(`Import up to ${MAX_HISTORY_IMPORT_ROWS} delivery rows at a time.`);
  for (const item of rows) if (item.cells.length !== headers.length) throw new Error(`Line ${item.line} has ${item.cells.length} fields; expected ${headers.length}.`);
  return { headers, rows };
}

const answerValues = {
  direction: ["unknown", "one-way", "two-way"],
  api: ["unknown", "documented", "custom"],
  quality: ["unknown", "clean", "mixed"],
  volume: ["unknown", "small", "medium", "large"],
  mapping: ["unknown", "standard", "custom"],
} as const;
function hoursValue(value: string, field: string, allowZero = false): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) throw new Error(`${field} must be a non-negative number using a period for decimals.`);
  const number = Number(normalized.replaceAll(",", ""));
  if (!Number.isFinite(number) || number > 10000 || (allowZero ? number < 0 : number <= 0)) throw new Error(`${field} must be ${allowZero ? "between 0 and" : "greater than 0 and at most"} 10,000 hours.`);
  return number;
}
function isoDate(value: string, field: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(trimmed);
  const parsed = Date.parse(trimmed);
  if (!match || !Number.isFinite(parsed)) throw new Error(`${field} must be an ISO date or timestamp with a timezone.`);
  const [, yearText, monthText, dayText] = match;
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (calendarDate.getUTCFullYear() !== Number(yearText) || calendarDate.getUTCMonth() !== Number(monthText) - 1 || calendarDate.getUTCDate() !== Number(dayText)) throw new Error(`${field} must be a real calendar date.`);
  return new Date(parsed).toISOString();
}

export function mapHistoryCsv(parsed: ParsedCsv, mapping: Partial<Record<HistoryImportField, string>>): MappedHistoryRow[] {
  const used = Object.entries(mapping).filter(([, header]) => !!header).map(([, header]) => header!.toLocaleLowerCase());
  const duplicateColumn = used.find((header, index) => used.indexOf(header) !== index);
  const missing = historyImportFields.filter(field => field.required && !mapping[field.key]).map(field => field.label);
  if (missing.length) throw new Error(`Map these required fields: ${missing.join(", ")}.`);
  if (duplicateColumn) throw new Error("Each CSV column can map to only one field.");
  for (const header of Object.values(mapping)) if (header && !parsed.headers.includes(header)) throw new Error("A mapped CSV column no longer exists. Choose the file again.");

  return parsed.rows.map(({ line, cells }) => {
    const errors: string[] = [];
    const read = (key: HistoryImportField) => {
      const header = mapping[key];
      return header ? cells[parsed.headers.indexOf(header)]?.trim() ?? "" : "";
    };
    try {
      const title = read("title");
      if (title.length < 3 || title.length > 120) throw new Error("Project name must be 3–120 characters.");
      const baselineAt = isoDate(read("baselineAt"), "Baseline date");
      const completedAt = isoDate(read("completedAt"), "Delivery date");
      if (Date.parse(baselineAt) > Date.parse(completedAt)) throw new Error("Baseline date must be on or before delivery date.");
      const answers = {} as Answers;
      for (const key of Object.keys(answerValues) as (keyof Answers)[]) {
        const value = read(key);
        if (!(answerValues[key] as readonly string[]).includes(value)) throw new Error(`${key} must be one of: ${answerValues[key].join(", ")}.`);
        (answers as Record<keyof Answers, string>)[key] = value;
      }
      const baseline: Partial<Record<Category, number>> = {}, actual: Partial<Record<Category, number>> = {};
      for (const category of categories) {
        const base = hoursValue(read(`baseline:${category}`), `Baseline ${category}`);
        const delivered = hoursValue(read(`actual:${category}`), `Actual ${category}`);
        if ((base === undefined) !== (delivered === undefined)) throw new Error(`${category} baseline and actual hours must both be filled or both be blank.`);
        if (base !== undefined && delivered !== undefined) { baseline[category] = base; actual[category] = delivered; }
      }
      if (!Object.keys(baseline).length) throw new Error("Provide at least one matching baseline and actual task pair.");
      const rangeLow = hoursValue(read("rangeLow"), "Original range low", true);
      const rangeHigh = hoursValue(read("rangeHigh"), "Original range high", true);
      if ((rangeLow === undefined) !== (rangeHigh === undefined)) throw new Error("Provide both original range values or leave both blank.");
      const estimateTotal = Object.values(baseline).reduce((sum, value) => sum + value, 0);
      if (rangeLow !== undefined && rangeHigh !== undefined && (rangeLow > estimateTotal || rangeHigh < estimateTotal || rangeLow > rangeHigh)) throw new Error("The original range must contain the total task baseline estimate.");
      const additionalHours = hoursValue(read("additionalHours"), "Added-scope hours", true) ?? 0;
      const additionalNotes = read("additionalNotes");
      if (additionalNotes.length > 3000) throw new Error("Added-scope explanation must be 3,000 characters or fewer.");
      if (additionalHours > 0 && additionalNotes.trim().length < 10) throw new Error("Explain added work in at least 10 characters when added-scope hours are nonzero.");
      const sourceId = read("sourceId");
      if (sourceId.length > 150) throw new Error("Source record ID must be 150 characters or fewer.");
      const row: HistoryImportRow = { ...(sourceId ? { sourceId } : {}), title, baselineAt, completedAt, answers, baseline, actual, ...(rangeLow !== undefined ? { rangeLow, rangeHigh } : {}), additionalHours, additionalNotes };
      return { line, row, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "This row is invalid.");
      return { line, errors };
    }
  });
}

export function canonicalHistoryRow(row: HistoryImportRow): string {
  return JSON.stringify({
    sourceId: row.sourceId?.trim().toLocaleLowerCase() ?? "",
    title: row.title.trim().toLocaleLowerCase(), baselineAt: row.baselineAt, completedAt: row.completedAt,
    answers: [row.answers.direction, row.answers.api, row.answers.quality, row.answers.volume, row.answers.mapping],
    baseline: categories.map(category => row.baseline[category] ?? null),
    actual: categories.map(category => row.actual[category] ?? null),
    rangeLow: row.rangeLow ?? null, rangeHigh: row.rangeHigh ?? null,
    additionalHours: row.additionalHours, additionalNotes: row.additionalNotes.trim(),
  });
}

export function historySourceKey(sourceFile: string, sourceId: string): string {
  return `${sourceFile.trim().toLocaleLowerCase()}\u0000${sourceId.trim().toLocaleLowerCase()}`;
}

export async function historyRowFingerprint(row: HistoryImportRow): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalHistoryRow(row)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function deterministicHistoryId(ownerId: string, fingerprint: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ownerId}:${fingerprint}`)));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function importedHistoryProject(row: HistoryImportRow, id: string, sourceFile: string, line: number, fingerprint: string, importedAt: string): Project {
  const included = categories.filter(category => row.baseline[category] !== undefined);
  const total = included.reduce((sum, category) => sum + row.baseline[category]!, 0);
  const estimate: Estimate = {
    tasks: included.map(category => ({ category, label: taskNames[category], base: row.baseline[category]!, factor: 1, hours: row.baseline[category]!, low: row.baseline[category]!, high: row.baseline[category]!, observations: 0 })),
    low: row.rangeLow ?? total, high: row.rangeHigh ?? total, hours: total, baseHours: total,
    blockers: [], assumptions: ["This historical estimate was imported from the source file; no estimator calculation was reconstructed."], references: [],
  };
  const notes = "Historical delivery imported from CSV. The original brief was not included.";
  return {
    schemaVersion: 2, id, title: row.title, brief: "Original client brief not supplied with this history import.",
    scope: {
      summary: "Completed historical integration work imported for reference.",
      requirements: included.map(category => ({ id: category, title: taskNames[category], evidence: "Imported task from the frozen historical baseline; no brief passage was supplied." })),
      initialAnswers: { ...row.answers }, risks: [], parser: "import",
    },
    answers: { ...row.answers }, excluded: categories.filter(category => !included.includes(category)), notes,
    versions: [{ id: `${id}-baseline`, revision: 1, at: row.baselineAt, estimate, answers: { ...row.answers }, excluded: categories.filter(category => !included.includes(category)), notes, historyPolicy: "recorded", confirmations: {}, reason: "Frozen source estimate imported from CSV.", rangeCoverageKnown: row.rangeLow !== undefined && row.rangeHigh !== undefined }],
    actuals: { hours: { ...row.actual }, additionalHours: row.additionalHours, explanation: row.additionalNotes, synthetic: false, at: row.completedAt },
    createdAt: row.baselineAt, updatedAt: importedAt, historyPolicy: "recorded", confirmations: {},
    importProvenance: { sourceFile, row: line, ...(row.sourceId ? { sourceId: row.sourceId } : {}), fingerprint, importedAt },
  };
}
