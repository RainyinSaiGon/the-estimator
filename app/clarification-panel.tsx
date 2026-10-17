"use client";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, Download, Loader2 } from "lucide-react";
import { clarificationPack, questionImpact } from "../lib/clarifications";
import { taskNames } from "../lib/estimator-data";
import type { Answers, Category, DriverKey, History, HistoryPolicy, Project } from "../lib/estimator-types";

type Props = { project: Project; answers: Answers; excluded: Category[]; history: History[]; policy: HistoryPolicy; notes: string; confirmKeys: DriverKey[]; busy: boolean; dirty: boolean; onAnswer: (key: DriverKey, value: string) => void; onPolicy: (policy: HistoryPolicy) => void; onNotes: (notes: string) => void; onConfirm: (key: DriverKey) => void; onSave: () => void; onEvidence: (quote: string) => void; onDownload: (text: string) => void };
export default function ClarificationPanel(props: Props) {
  const { project, answers, excluded, history, policy, notes, confirmKeys, busy, dirty } = props;
  const [copyMessage, setCopyMessage] = useState("");
  const current = { ...project, answers, excluded, historyPolicy: policy };
  const ranked = questionImpact(current, history);
  const missing = ranked.filter(q => q.unknown).length, critical = ranked.filter(q => q.critical).length;
  async function copy() {
    try { await navigator.clipboard.writeText(clarificationPack(current, history)); setCopyMessage("Questions copied. Review them before sharing."); }
    catch { setCopyMessage("Clipboard unavailable. Download the questions instead."); }
  }
  return <section className="panel clarification-panel">
    <div className="panel-heading"><div><h2>Ask what changes the work</h2><p>Resolve blockers first, then the unknowns with the largest effect on effort.</p></div><span className={`tag ${critical ? "amber" : "green"}`}>{critical ? `${critical} CRITICAL` : "READY TO REVIEW"}</span></div>
    <div className="clarification-toolbar"><span>{missing} unanswered {missing === 1 ? "question" : "questions"}</span><div><button className="button small" disabled={!missing} onClick={copy}><Copy size={14} />Copy questions</button><button className="icon-button" aria-label="Download clarification questions" disabled={!missing} onClick={() => props.onDownload(clarificationPack(current, history))}><Download size={16} /></button></div></div>
    {copyMessage && <p className="copy-feedback" role="status">{copyMessage}</p>}
    <div className="ranked-questions">{ranked.map((q, index) => {
      const confirmation = project.confirmations?.[q.key];
      const confirmed = confirmation?.value === answers[q.key];
      const pending = confirmKeys.includes(q.key) || answers[q.key] !== project.answers[q.key];
      return <div className={`ranked-question ${q.critical ? "critical-question" : ""}`} key={q.key}>
        <div className="question-meta"><span>{String(index + 1).padStart(2, "0")} / {q.unknown ? "NEEDS AN ANSWER" : "REVIEW THE ANSWER"}</span><span className={`tag ${confirmed && !pending ? "green" : q.critical ? "amber" : "neutral"}`}>{pending ? "UNSAVED" : confirmed ? "HUMAN CONFIRMED" : q.unknown ? "UNKNOWN" : q.support ? "SOURCE FACT" : "PROVISIONAL"}</span></div>
        <label htmlFor={`answer-${q.key}`}>{q.label}</label>
        <select id={`answer-${q.key}`} disabled={!!project.actuals || busy} value={answers[q.key]} onChange={e => props.onAnswer(q.key, e.target.value)}>{[["unknown", "Needs clarification"], ...q.options.map(o => [o.value, o.label])].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
        <p className="question-help">{q.help}</p>
        {q.unknown && <div className="impact-summary"><strong>{q.low}–{q.high} h</strong><span>whole-project effort across possible answers</span></div>}
        <details className="sensitivity-options"><summary>{q.unknown ? "Explore the possible answers" : "Compare other answers"}</summary><div>{q.options.map(o => <button key={o.value} disabled={!!project.actuals || busy} onClick={() => props.onAnswer(q.key, o.value)}><span>{o.label}</span><strong>{o.hours} h</strong></button>)}<p>Affected work: {q.affected.map(c => taskNames[c]).join(", ") || "No change to central task hours"}. Other inputs and the history dataset stay fixed. This is model sensitivity, not a quote or probability.</p></div></details>
        {(q.support || q.context) ? <div className="question-evidence"><small>{q.support ? "Supporting source passage" : "Related context · does not confirm the answer"}</small><blockquote>“{q.support || q.context}”</blockquote><button className="text-button" onClick={() => props.onEvidence((q.support || q.context)!)}>Show in brief <ArrowUpRight size={12} /></button></div> : <p className="missing-evidence">No verified source passage for this detail. Record a client confirmation.</p>}
        {confirmed && !pending && <p className="confirmation-note">Confirmed {new Date(confirmation.at).toLocaleString("en-GB")}{confirmation.notes && <> · {confirmation.notes}</>}</p>}
        {!q.unknown && !project.actuals && (answers[q.key] !== project.answers[q.key] ? <p className="confirmation-note">Save clarifications to record this confirmation.</p> : <button className="text-button confirm-answer" onClick={() => props.onConfirm(q.key)}>{confirmKeys.includes(q.key) ? "Undo pending confirmation" : confirmed ? "Reconfirm this answer" : "Confirm this answer"}<Check size={13} /></button>)}
      </div>;
    })}</div>
    <div className="review-notes"><label htmlFor="history-policy">History used for this estimate</label><select id="history-policy" disabled={!!project.actuals || busy} value={policy} onChange={e => props.onPolicy(e.target.value as HistoryPolicy)}><option value="recorded">Recorded deliveries only</option><option value="demo">Include synthetic demonstration history</option></select><p className="field-help">{policy === "recorded" ? "Synthetic examples are excluded. Without comparable recorded work, base assumptions are used." : "Demonstration mode includes synthetic examples. It does not establish real predictive accuracy."}</p><label htmlFor="scope-notes">Review notes & agreed exclusions</label><textarea id="scope-notes" disabled={!!project.actuals} value={notes} onChange={e => props.onNotes(e.target.value)} placeholder="Record who confirmed the details and what was agreed…" maxLength={3000} rows={3} /></div>
    <div className="panel-actions"><span className="muted">{dirty ? "Unsaved review · estimate preview updated" : "Clarifications are saved"}</span><button className="button primary" disabled={busy || !dirty || !!project.actuals} onClick={props.onSave}>{busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}Save clarifications</button></div>
  </section>;
}
