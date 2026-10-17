"use client";
import { useState } from "react";
import { learningReport } from "../lib/learning";
import type { Project } from "../lib/estimator-types";
const hours = (n: number | null) => n === null ? "—" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n)} h`;
export default function LearningReport({ projects }: { projects: Project[] }) {
  const [synthetic, setSynthetic] = useState(false);
  const report = learningReport(projects, synthetic);
  const recorded = learningReport(projects, false).n, examples = learningReport(projects, true).n;
  return <section className="panel learning-report"><div className="panel-heading"><div><h2>Is calibration helping?</h2><p>Compare saved predictions with actual effort for their original scope.</p></div><span className="tag neutral">FROZEN PREDICTIONS</span></div>
    <div className="cohort-switch" role="group" aria-label="Learning report data"><button aria-pressed={!synthetic} onClick={() => setSynthetic(false)}>Recorded deliveries <span>{recorded}</span></button><button aria-pressed={synthetic} onClick={() => setSynthetic(true)}>Synthetic deliveries <span>{examples}</span></button></div>
    {!report.n ? <div className="learning-empty"><h3>{synthetic ? "No completed synthetic deliveries yet." : "No recorded outcomes to evaluate yet."}</h3><p>{synthetic ? "Complete a sample request with illustrative hours to explore the calculation." : "Save a baseline, deliver the work, then record original-scope hours. The reference library alone cannot establish prediction accuracy."}</p></div> : <>
      <div className="learning-metrics"><div><span>Base estimate MAE</span><strong>{hours(report.baseMAE)}</strong></div><div><span>Adjusted estimate MAE</span><strong>{hours(report.adjustedMAE)}</strong></div><div><span>Adjusted signed bias</span><strong>{hours(report.bias)}</strong></div><div><span>Observed range coverage</span><strong>{report.covered}/{report.n}<small> · {Math.round((report.coverage ?? 0) * 100)}%</small></strong></div></div>
      <div className="learning-explanation">{synthetic ? "Synthetic demonstration outcomes do not establish real-world accuracy." : `Based on ${report.n} recorded ${report.n === 1 ? "delivery" : "deliveries"}. Small samples cannot establish reliable accuracy improvement.`} {report.baseMAE !== null && report.adjustedMAE !== null && <>{report.baseMAE === report.adjustedMAE ? "Base and adjusted mean absolute error are equal in this cohort." : <>The adjustment's mean absolute error is {hours(Math.abs(report.baseMAE - report.adjustedMAE))} {report.adjustedMAE < report.baseMAE ? "lower" : "higher"} than the base estimate in this cohort.</>}</>}</div>
      <div className="table-scroll"><table><thead><tr><th>Project / baseline</th><th>Base</th><th>Adjusted</th><th>Actual</th><th>Absolute error</th></tr></thead><tbody>{report.rows.map(r => <tr key={r.id}><td><strong>{r.name}</strong><small className="table-subline">v{r.revision} · {r.provenanceKnown ? "Provenance recorded" : "Legacy provenance unknown"} · {r.policy === "demo" ? "Demo history" : r.policy === "recorded" ? "Recorded history" : "History policy unknown"} · added {hours(r.added)} excluded</small></td><td>{hours(r.base)}</td><td>{hours(r.adjusted)}</td><td>{hours(r.actual)}</td><td>{hours(r.adjustedError)}</td></tr>)}</tbody></table></div>
    </>}
    <div className="panel-footnote">MAE is mean absolute error. Positive bias means overestimation; negative means underestimation. Range coverage is descriptive, not a calibrated confidence level. Historical predictions are never recalculated with newer outcomes.{report.excluded > 0 && <> {report.excluded} incomplete or chronologically invalid records excluded.</>}</div>
  </section>;
}
