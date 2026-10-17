"use client";
import { useEffect, useState } from "react";
import { ArrowDownToLine, FileUp, Loader2, ShieldCheck } from "lucide-react";
import { categories, type Project } from "../lib/estimator-types";
import { historyImportFields, historyRowFingerprint, historySourceKey, mapHistoryCsv, MAX_HISTORY_CSV_BYTES, parseHistoryCsv, type HistoryImportField, type HistoryImportRow, type MappedHistoryRow, type ParsedCsv } from "../lib/history-import";
import { tw } from "./tailwind-utilities";

type ImportProject = Pick<Project, "importProvenance">;
type Props = {
  existing: ImportProject[];
  onImport: (sourceFile: string, records: { line: number; row: HistoryImportRow }[]) => Promise<{ importedCount: number; skippedCount: number }>;
};
const total = (values: Partial<Record<(typeof categories)[number], number>>) => Object.values(values).reduce((sum, value) => sum + (value ?? 0), 0);
const fmt = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
function downloadTemplate() {
  const contents = `${historyImportFields.map(field => field.header).join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "estimator-history-template.csv"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HistoryCsvImport({ existing, onImport }: Props) {
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [sourceFile, setSourceFile] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<HistoryImportField, string>>>({});
  const [preview, setPreview] = useState<MappedHistoryRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mappingError, setMappingError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!parsed) { setPreview([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const mapped = mapHistoryCsv(parsed, mapping);
        setMappingError("");
        const known = new Set(existing.map(project => project.importProvenance?.fingerprint).filter((value): value is string => !!value));
        const knownSourceIds = new Set(existing.flatMap(project => project.importProvenance?.sourceId ? [historySourceKey(project.importProvenance.sourceFile, project.importProvenance.sourceId)] : []));
        const fingerprints = await Promise.all(mapped.map(async item => item.row && !item.errors.length ? historyRowFingerprint(item.row) : undefined));
        const seen = new Set<string>();
        const seenSourceIds = new Set<string>();
        const rows = mapped.map((item, index) => {
          const fingerprint = fingerprints[index];
          if (!item.row || !fingerprint) return item;
          const sourceKey = item.row.sourceId ? historySourceKey(sourceFile, item.row.sourceId) : undefined;
          const duplicate = known.has(fingerprint) || seen.has(fingerprint) || !!sourceKey && (knownSourceIds.has(sourceKey) || seenSourceIds.has(sourceKey));
          seen.add(fingerprint);
          if (sourceKey) seenSourceIds.add(sourceKey);
          return { ...item, fingerprint, duplicate };
        });
        if (cancelled) return;
        setPreview(rows);
        setSelected(new Set(rows.filter(item => item.row && !item.errors.length && !item.duplicate).map(item => item.line)));
      } catch (reason) {
        if (cancelled) return;
        setMappingError(reason instanceof Error ? reason.message : "Map the CSV columns to preview the rows.");
        setPreview([]);
      }
    })();
    return () => { cancelled = true; };
  }, [parsed, mapping, existing, sourceFile]);

  async function chooseFile(file?: File) {
    setError(""); setMessage(""); setSelected(new Set()); setPreview([]); setMappingError(""); setParsed(null); setSourceFile("");
    if (!file) return;
    if (file.size > MAX_HISTORY_CSV_BYTES) { setError("CSV files must be 250 KB or smaller."); return; }
    try {
      const next = parseHistoryCsv(await file.text());
      setSourceFile(file.name); setParsed(next);
      setMapping(Object.fromEntries(historyImportFields.map(field => [field.key, next.headers.includes(field.header) ? field.header : ""])) as Partial<Record<HistoryImportField, string>>);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read the CSV file."); }
  }

  async function submit() {
    setBusy(true); setError(""); setMessage("");
    try {
      const records = preview.filter(item => selected.has(item.line) && item.row && !item.errors.length && !item.duplicate).map(item => ({ line: item.line, row: item.row! }));
      if (!records.length) throw new Error("Select at least one valid, non-duplicate row.");
      const result = await onImport(sourceFile, records);
      setMessage(`${result.importedCount} delivery record${result.importedCount === 1 ? "" : "s"} imported${result.skippedCount ? `; ${result.skippedCount} duplicate${result.skippedCount === 1 ? "" : "s"} skipped` : ""}.`);
      setParsed(null); setPreview([]); setSelected(new Set()); setSourceFile("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The import could not be saved."); }
    finally { setBusy(false); }
  }

  const validCount = preview.filter(item => item.row && !item.errors.length && !item.duplicate).length;
  const selectedCount = preview.filter(item => selected.has(item.line) && item.row && !item.errors.length && !item.duplicate).length;
  return <section className={tw("panel history-import")}>
    <div className={tw("panel-heading")}><div><h2>Bring in delivery history</h2><p>Review completed project records before adding them to this private workspace.</p></div><button className={tw("button")} type="button" onClick={downloadTemplate}><ArrowDownToLine size={15} />Download CSV template</button></div>
    <div className={tw("history-import-content")}>
      <div className={tw("import-privacy")}><ShieldCheck size={16} /><span>Files are validated in your browser and imported only to your signed-in workspace. They are not sent to an AI provider.</span></div>
      <details className={tw("import-mapping import-guide")}><summary>CSV format and validation</summary><p>Use ISO dates (YYYY-MM-DD or a timestamp with a timezone). Driver values are direction: unknown, one-way, two-way; api: unknown, documented, custom; quality: unknown, clean, mixed; volume: unknown, small, medium, large; mapping: unknown, standard, custom.</p><p>For each task, baseline and actual hours must both be filled or both blank. Filled task hours must be greater than 0 and at most 10,000. Original estimate range columns are optional but must be supplied together. Added-scope hours may be 0; if greater than 0, add an explanation of at least 10 characters. Files are limited to 250 KB and 25 delivery rows.</p></details>
      <label className={tw("import-file")}><span><FileUp size={16} />Choose a CSV file</span><input type="file" accept=".csv,text/csv" onChange={event => { void chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
      {sourceFile && <p className={tw("import-file-name")}>Selected: <strong>{sourceFile}</strong> · {parsed?.rows.length ?? 0} rows · {validCount} valid and ready</p>}
      {error && <p className={tw("form-error")} role="alert">{error}</p>}
      {message && <p className={tw("import-success")} role="status">{message}</p>}
      {parsed && <>
        <details className={tw("import-mapping")} open={!!mappingError}>
          <summary>Map source columns <span>Matched by header when possible; adjust to fit your CSV.</span></summary>
          {mappingError && <p className={tw("form-error")} role="alert">{mappingError}</p>}
          <div className={tw("import-mapping-grid")}>{historyImportFields.map(field => <label key={field.key}>{field.label}{field.required && <span aria-hidden="true"> *</span>}<select aria-label={`CSV column for ${field.label}`} value={mapping[field.key] ?? ""} onChange={event => setMapping(current => ({ ...current, [field.key]: event.target.value }))}><option value="">Not mapped</option>{parsed.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
          <small>* Required column. Each source column must map to at most one field. Leave both range columns unmapped when the original estimate range is unavailable.</small>
        </details>
        {!mappingError && <div className={tw("table-scroll import-preview")}><table><thead><tr><th><span className={tw("sr-only")}>Select</span></th><th>Line / project</th><th>Baseline</th><th>Original actual</th><th>Added scope</th><th>Review</th></tr></thead><tbody>{preview.map(item => {
          const row = item.row;
          const state = item.errors.length ? item.errors.join(" ") : item.duplicate ? "Already imported or repeated in this file." : "Ready to import.";
          return <tr key={item.line}><td><input aria-label={`Select row ${item.line}`} type="checkbox" disabled={!row || !!item.errors.length || item.duplicate || busy} checked={selected.has(item.line)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.line) : next.delete(item.line); return next; })} /></td><td><strong>Line {item.line}</strong>{row && <small className={tw("table-subline")}>{row.title}</small>}</td><td>{row ? `${fmt(total(row.baseline))} h` : "—"}</td><td>{row ? `${fmt(total(row.actual))} h` : "—"}</td><td>{row ? `${fmt(row.additionalHours)} h` : "—"}</td><td><span className={tw(`tag ${item.errors.length || item.duplicate ? "amber" : "green"}`)}>{state}</span></td></tr>;
        })}</tbody></table></div>}
        {!mappingError && <div className={tw("panel-actions import-actions")}><small>{selectedCount} of {validCount} valid, non-duplicate rows selected. Import requires matching task-level baseline and actual hours.</small><button className={tw("button primary")} disabled={!selectedCount || busy} onClick={() => void submit()}>{busy ? <Loader2 size={16} className={tw("spin")} /> : <FileUp size={16} />}{busy ? "Importing…" : `Import ${selectedCount} record${selectedCount === 1 ? "" : "s"}`}</button></div>}
      </>}
      {!parsed && !message && <p className={tw("field-help")}>Each imported row must include scope drivers, a frozen task estimate, matching original-scope actuals, and any added-scope hours. Missing historical estimates are never reconstructed.</p>}
    </div>
  </section>;
}
