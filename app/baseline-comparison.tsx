"use client";
import { useState } from "react";
import { ArrowDownToLine, GitCompareArrows } from "lucide-react";
import { compareBaselines, comparisonMarkdown } from "../lib/baselines";
import type { ReviewState } from "../lib/baselines";
import type { Project, Snapshot } from "../lib/estimator-types";
const delta = (n: number) => `${n > 0 ? "+" : ""}${Number(n.toFixed(1))}`;
export default function BaselineComparison({ project, draft, onExport, onChangeExport }: { project: Project; draft: ReviewState; onExport: (version: Snapshot) => void; onChangeExport: (body: string) => void }) {
  const latest = project.versions.at(-1)!;
  const [leftId, setLeftId] = useState(latest.id), [rightId, setRightId] = useState("draft");
  const left = project.versions.find(v => v.id === leftId) ?? latest;
  const right = rightId === "draft" ? draft : project.versions.find(v => v.id === rightId) ?? latest;
  const rightLabel = rightId === "draft" ? project.actuals ? "Current engine preview" : "Current draft" : `Baseline v${(right as Snapshot).revision}`;
  const comparison = compareBaselines(left, right);
  return <section className="panel baseline-comparison"><div className="panel-heading"><div><h2>What changed from the agreement?</h2><p>Saved versions keep their original numbers. Compare the decisions behind the change.</p></div><GitCompareArrows size={20} /></div>
    <div className="comparison-controls"><div><label htmlFor="compare-from">Compare from</label><select id="compare-from" value={left.id} onChange={e => setLeftId(e.target.value)}>{project.versions.map(v => <option key={v.id} value={v.id}>Baseline v{v.revision} · {v.estimate.hours} h</option>)}</select></div><div><label htmlFor="compare-to">Compare to</label><select id="compare-to" value={rightId} onChange={e => setRightId(e.target.value)}><option value="draft">{project.actuals ? "Current engine preview" : "Current draft"}</option>{project.versions.map(v => <option key={v.id} value={v.id}>Baseline v{v.revision} · {v.estimate.hours} h</option>)}</select></div></div>
    <div className="comparison-totals"><span>{left.estimate.hours} h <span aria-hidden="true">→</span> {right.estimate.hours} h</span><strong>{delta(comparison.delta)} h</strong><small>Range {left.estimate.low}–{left.estimate.high} → {right.estimate.low}–{right.estimate.high} h</small></div>
    <div className="comparison-causes"><h3>Scope and review decisions</h3>{[...comparison.drivers, ...comparison.inclusions].length ? <ul>{[...comparison.drivers, ...comparison.inclusions].map(d => <li key={d.label}><strong>{d.label}</strong><span>{d.from} → {d.to}</span></li>)}</ul> : <p>No driver or inclusion changes.</p>}{comparison.notesChanged && <p>Review notes changed: {right.notes || "Notes cleared."}</p>}<h3>Calculation context</h3><p>{comparison.policyChanged ? "History policy changed." : "Same history policy."} {comparison.referencesChanged === null ? "Legacy reference provenance is unknown." : comparison.referencesChanged ? "Contributing reference set changed." : "Same contributing reference set."} {comparison.engineChanged === null ? "Legacy engine version is unknown." : comparison.engineChanged ? "Engine version changed." : "Same engine version."}</p><small>Several causes can affect the total. This comparison does not assign an invented share of the hours to each cause.</small>{left.reason && <p>Baseline v{left.revision} reason: {left.reason}</p>}</div>
    <div className="table-scroll"><table><thead><tr><th>Work item</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>{comparison.tasks.map(t => <tr key={t.category}><td>{t.label}</td><td>{t.from} h</td><td>{t.to} h</td><td>{delta(t.to - t.from)} h</td></tr>)}</tbody></table></div>
    <div className="panel-actions"><button className="text-button" onClick={() => onExport(left)}><ArrowDownToLine size={14} />Export baseline v{left.revision}</button><button className="button small" onClick={() => onChangeExport(comparisonMarkdown(project.title, left, right, `Baseline v${left.revision}`, rightLabel))}>Export change summary</button></div>
  </section>;
}
