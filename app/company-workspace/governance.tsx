"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, ClipboardList, Target } from "lucide-react";
import type { ClientRequest, Company, CompanyRole, WorkspaceResponse } from "../../lib/client-workflow-types";
import { workflowInsights } from "../../lib/workflow-insights";
import { button, secondary, input, label, Section as Card } from "./ui";

type Action = (body: Record<string, unknown>) => Promise<WorkspaceResponse | undefined>;
function Field({ title, children }: { title: string; children: ReactNode }) { return <label className={label}>{title}{children}</label>; }

export function MembersPanel({ company, actorId, busy, action, publicDemo = false }: { company?: Company; actorId: string; busy: boolean; action: Action; publicDemo?: boolean }) {
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<CompanyRole>("viewer");
  return <div className="space-y-5">
    <Card title={publicDemo ? "Shared public demo identity" : "Your Site account ID"}>
      <p className="mb-3 text-sm leading-6 text-[var(--muted)]">{publicDemo
        ? "Every anonymous visitor uses the same demo administrator identity. Adding a member here does not create a public sign-in or an independent reviewer account."
        : "Share this ID with your organization administrator to request access. Membership is tied to your stable signed-in Site identity."}</p>
      <input aria-label={publicDemo ? "Shared public demo identity" : "Your Site account ID"} className={input + " font-mono"} readOnly value={actorId}/>
    </Card>
    {company && <Card title="Organization members">
      <p className="mb-4 text-sm leading-6 text-[var(--muted)]">Admins manage settings and access. Estimators review scope and submit actuals. Reviewers independently approve delivery evidence. Viewers have read access. Every action is checked by the server.</p>
      <ul className="space-y-3">{company.members.map(member => <li key={member.userId} className="rounded-xl border border-[var(--line)] p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm">{member.displayName}</strong><p className="break-all font-mono text-xs text-[var(--muted)]">{member.userId}</p><p className="mt-1 text-xs">{member.role}{member.owner ? " · owner" : ""}</p></div>{company.role === "admin" && !member.owner && <button disabled={busy} className={secondary} onClick={() => void action({ action: "removeMember", userId: member.userId })}>Remove access</button>}</div></li>)}</ul>
      {company.role === "admin" && <form className="mt-5 grid gap-3 md:grid-cols-2" onSubmit={async event => { event.preventDefault(); if (await action({ action: "setMember", userId, displayName, role })) { setUserId(""); setDisplayName(""); } }}>
        <Field title="Member Site account ID"><input className={input} required minLength={3} maxLength={200} value={userId} onChange={event => setUserId(event.target.value)}/></Field>
        <Field title="Display label"><input className={input} required maxLength={100} value={displayName} onChange={event => setDisplayName(event.target.value)}/></Field>
        <Field title="Organization role"><select className={input} value={role} onChange={event => setRole(event.target.value as CompanyRole)}>{["viewer", "estimator", "reviewer", "admin"].map(value => <option key={value}>{value}</option>)}</select></Field>
        <div className="flex items-end"><button className={button} disabled={busy}>Add or update member</button></div>
      </form>}
    </Card>}
  </div>;
}
export function ConnectorsPanel({ company, publicDemo = false, busy, action }: { company: Company; publicDemo?: boolean; busy: boolean; action: Action }) {
  const [credential, setCredential] = useState<{ kind: string; value: string }>();
  const admin = company.role === "admin";
  async function rotate(kind: "webhook" | "mcp") {
    const result = await action({ action: "rotateCredential", kind });
    if (result?.issuedCredential) setCredential(result.issuedCredential);
  }
  async function revoke(kind: "webhook" | "mcp") {
    if (window.confirm("Revoke this credential? Any sender using it will stop working immediately.")) {
      await action({ action: "revokeCredential", kind });
      setCredential(undefined);
    }
  }
  const credentialLabel = credential?.kind === "webhook" ? "webhook signing secret" : "MCP access token";
  return <div className="space-y-5">
    {credential && <Card title={"New " + (publicDemo ? "demo " : "") + credentialLabel}>
      <p className="mb-3 text-sm leading-6">{publicDemo
        ? "Copy this now. It is shown only once. Anyone with access to this shared demo can rotate or revoke demo credentials. Never use this value with a real company or production service."
        : "Copy this now to your sender or MCP client secret store. It is shown only once; rotation invalidates the previous credential."}</p>
      <input aria-label={"New " + credentialLabel} type="text" autoComplete="off" spellCheck={false} readOnly className={input + " font-mono"} value={credential.value}/>
      <div className="mt-3 flex flex-wrap gap-3"><button className={secondary} onClick={() => void navigator.clipboard.writeText(credential.value)}>Copy credential</button><button className={secondary} onClick={() => setCredential(undefined)}>Dismiss credential</button></div>
    </Card>}
    <Card title="Demo-form and CRM webhook">
      <p className="text-sm leading-6">Status: <strong>{company.connectors.webhookConfigured ? "Configured" : "Not configured"}</strong>. Gmail polling is deferred.</p>
      {publicDemo && <p role="note" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">This endpoint writes to the shared demo, starts live AI analysis, and accepts fictional submissions only. Public demo requests are forced into the synthetic cohort. Any visitor can rotate or revoke its demo secret.</p>}
      <a className="mt-3 block break-all font-mono text-xs underline" href={"/api/company-workspace/inbound/" + company.id}>/api/company-workspace/inbound/{company.id}</a>
      <details className="mt-3 rounded-xl bg-[var(--paper)] p-3">
        <summary className="cursor-pointer text-sm font-medium">Payload, signing and file limits</summary>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Send JSON with submissionId, title, text, cohort, and optional attachments (name, contentBase64). Sign the exact UTF-8 bytes timestamp + &quot;.&quot; + rawBody with HMAC-SHA256. Send the RFC3339 UTC timestamp in X-Workflow-Timestamp and lowercase hexadecimal signature in X-Workflow-Signature. Timestamps expire after five minutes. Stable event IDs deduplicate retries; changed content needs a new event ID.</p>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">5 MB payload; ten files, 2 MB each, 4 MB combined. Word, Excel, CSV and text are extracted on intake. Webhook PDFs are retained and flagged for reviewer reconciliation; upload through Requests for page extraction. The form system owner configures the sender.</p>
      </details>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Last accepted submission: {company.connectors.lastInboundAt ? new Date(company.connectors.lastInboundAt).toLocaleString() : "None"}. Analysis failures and retries appear on the request.</p>
      {admin && <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy || !company.connectors.encryptionReady} onClick={() => void rotate("webhook")}>{company.connectors.webhookConfigured ? "Rotate webhook secret" : "Enable webhook"}</button><button className={secondary} disabled={busy || !company.connectors.webhookConfigured} onClick={() => void revoke("webhook")}>Revoke webhook</button></div>}
      {!company.connectors.encryptionReady && <p className="mt-3 text-sm text-amber-900">The Site administrator must configure WORKFLOW_ENCRYPTION_KEY before webhook activation.</p>}
    </Card>
    <Card title="Approved knowledge through MCP">
      <p className="text-sm leading-6">MCP provides read-only tools: company_list, knowledge_search, knowledge_fetch and company_intake_schema. Only active approved company sources are returned, with source URLs, digests and retrieval dates.</p>
      <a className="mt-3 block break-all font-mono text-xs underline" href="/mcp">/mcp</a>
      <p className="mt-2 text-xs leading-5 text-estimator-muted">Connect the root URL, call company_list, then pass companyId to the knowledge or intake tools. A company-specific /mcp?company=… URL also works.</p>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Use Streamable HTTP with a signed-in Site identity or Authorization: Bearer &lt;company token&gt;. Tokens can read approved knowledge and the intake schema; they cannot change requests, roles or approvals. Revoking the token or removing its issuer membership invalidates it.</p>
      {publicDemo && <p role="note" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">Demo token access is limited to this shared demo company. It is read-only, but any visitor can create, rotate or revoke it. Never use it in a real MCP client.</p>}
      {admin && <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void rotate("mcp")}>{company.connectors.mcpConfigured ? "Rotate knowledge token" : "Create knowledge token"}</button><button className={secondary} disabled={busy || !company.connectors.mcpConfigured} onClick={() => void revoke("mcp")}>Revoke knowledge token</button></div>}
      <a className="mt-4 block text-sm underline" href={"/api/company-workspace/schema?company=" + company.id}>Read versioned intake JSON Schema</a>
    </Card>
  </div>;
}
export function DeliveryPanel({ company, request, actorId, busy, action }: { company: Company; request: ClientRequest; actorId: string; busy: boolean; action: Action }) {
  const baseline = request.baselines.at(-1)!;
  const [hours, setHours] = useState<Record<string, string>>({});
  const [added, setAdded] = useState("0");
  const [evidence, setEvidence] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [notes, setNotes] = useState("");
  const [inspected, setInspected] = useState(false);
  const outcome = request.delivery?.at(-1);
  const canSubmit = ["admin", "estimator"].includes(company.role) && (!outcome || outcome.status === "rejected");
  const reviewers = company.members.filter(member => member.userId !== actorId && ["admin", "reviewer"].includes(member.role));
  return <Card title="Delivery actuals and independent review"><p className="mb-4 rounded-xl bg-[var(--paper)] p-3 text-sm leading-6">{baseline.evaluation ? `${baseline.evaluation.cohort} cohort · ${baseline.evaluation.split} · ${baseline.evaluation.domain}. Split declared ${new Date(baseline.evaluation.declaredAt).toLocaleString()}.` : "Legacy baseline: no declared split; excluded from evaluation."} Added scope is kept separate. Holdout outcomes are never used to tune this estimator.</p>{(request.delivery ?? []).map(item => <article key={item.id} className="mb-4 rounded-xl border border-[var(--line)] p-4"><strong className="text-sm">{item.status.toUpperCase()} · original {item.originalHours} h · added {item.addedScopeHours} h</strong><p className="mt-2 break-words text-xs leading-6">Submitted by {item.submittedName} at {new Date(item.submittedAt).toLocaleString()}. Designated reviewer: {company.members.find(member => member.userId === item.reviewerId)?.displayName ?? item.reviewerId}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.evidence}</p>{item.reviewedAt && <p className="mt-2 break-words text-xs leading-6">Reviewed by {item.reviewedName} at {new Date(item.reviewedAt).toLocaleString()}: {item.reviewNotes}</p>}</article>)}{baseline.evaluation && canSubmit && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void action({ action: "submitDelivery", requestId: request.id, expectedVersion: request.version, actualHours: Object.fromEntries(baseline.review.workPackages.map(item => [item.id, Number(hours[item.id])])), addedScopeHours: Number(added), evidence, reviewerId: reviewer, deliveredAt: new Date(deliveredAt).toISOString(), originalScopeOnly: acknowledged }); }}><h3 className="text-sm font-semibold">Original-scope task actuals</h3>{baseline.review.workPackages.map(item => <Field key={item.id} title={`${item.title} · actual hours`}><input className={input} type="number" min="0" max="100000" step="0.1" required value={hours[item.id] ?? ""} onChange={event => setHours(current => ({ ...current, [item.id]: event.target.value }))}/></Field>)}<div className="grid gap-4 md:grid-cols-2"><Field title="Added-scope hours (excluded from evaluation)"><input className={input} type="number" min="0" max="100000" step="0.1" required value={added} onChange={event => setAdded(event.target.value)}/></Field><Field title="Delivery completed at"><input className={input} type="datetime-local" required value={deliveredAt} onChange={event => setDeliveredAt(event.target.value)}/></Field></div><Field title="Delivery evidence and original-scope reconciliation"><textarea className={input} minLength={20} maxLength={5000} rows={4} required value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="References to time records, acceptance evidence, and how added scope was excluded"/></Field><Field title="Independent reviewer"><select className={input} required value={reviewer} onChange={event => setReviewer(event.target.value)}><option value="">Choose a different reviewer</option>{reviewers.map(member => <option key={member.userId} value={member.userId}>{member.displayName} · {member.role}</option>)}</select></Field>{!reviewers.length && <p className="text-sm text-amber-900">An administrator must add a different signed-in reviewer in Members before actuals can be submitted.</p>}<label className="flex gap-2 text-sm"><input type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>These task hours cover the frozen original scope; added work is recorded separately.</label><button className={button} disabled={busy || !reviewers.length}>Submit actuals for review</button></form>}{outcome?.status === "pending" && outcome.reviewerId === actorId && outcome.submittedBy !== actorId && ["admin", "reviewer"].includes(company.role) && <div className="space-y-3"><Field title="Independent review notes"><textarea className={input} minLength={20} maxLength={3000} rows={4} value={notes} onChange={event => setNotes(event.target.value)}/></Field><label className="flex gap-2 text-sm"><input type="checkbox" checked={inspected} onChange={event => setInspected(event.target.checked)}/>I independently inspected the evidence and reconciled original scope against this frozen baseline.</label><div className="flex flex-wrap gap-2">{(["approved", "rejected"] as const).map(decision => <button key={decision} className={decision === "approved" ? button : secondary} disabled={busy || !inspected || notes.trim().length < 20} onClick={() => void action({ action: "reviewDelivery", requestId: request.id, expectedVersion: request.version, outcomeId: outcome.id, decision, notes, evidenceInspected: inspected })}>{decision === "approved" ? "Approve delivery evidence" : "Reject delivery evidence"}</button>)}</div></div>}{outcome?.status === "pending" && outcome.submittedBy === actorId && <p className="mt-3 text-sm text-amber-900">Awaiting the designated independent reviewer. You cannot approve your own submitted actuals.</p>}</Card>;
}

export function EvaluationPanel({ company, publicDemo = false, onOpenRequest, onOpenRequests }: { company: Company; publicDemo?: boolean; onOpenRequest: (id: string, action?: string) => void; onOpenRequests: () => void }) {
  const [view, setView] = useState<"ai" | "delivery">("ai");
  const insights = workflowInsights(company.requests, company.config);
  const evaluation = company.evaluation;
  const committedRequest = company.requests.find(request => request.baselines.length > 0);
  function deliveryMetrics(cohort: "recorded" | "synthetic") {
    const metrics = evaluation[cohort];
    const rows = [
      ["Average effort difference", metrics.baseMAEHours == null ? "Awaiting evidence" : `${metrics.baseMAEHours} h`],
      ["After delivery-history adjustment", metrics.adjustedMAEHours == null ? "Awaiting evidence" : `${metrics.adjustedMAEHours} h`],
      ["Average over / under estimate", metrics.signedBiasHours == null ? "Awaiting evidence" : `${metrics.signedBiasHours > 0 ? "+" : ""}${metrics.signedBiasHours} h`],
      ["Deliveries within planned range", metrics.rangeCoverage == null ? "Awaiting evidence" : `${(metrics.rangeCoverage * 100).toFixed(1)}%`],
    ];
    return <><dl className="grid gap-3 sm:grid-cols-2">{rows.map(([title, value]) => <div className="rounded-xl bg-estimator-paper p-4" key={title}><dt className="text-xs leading-5 text-estimator-muted">{title}</dt><dd className="mt-2 text-xl font-semibold tracking-tight">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-6 text-estimator-muted">Based on {metrics.n} independently reviewed {cohort === "recorded" ? "real deliveries reserved for evaluation" : "demo deliveries"}. Positive bias means the plan was higher than actual effort. Range coverage uses the original configured range.</p><p className="mt-2 text-xs leading-6 text-estimator-muted">{metrics.n < 30 ? "This sample is too small to establish accuracy or improvement." : "These observations describe this sample. Representative evidence and a predefined comparison are needed to establish improvement."}</p></>;
  }
  return <div className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl"><h2 className="text-2xl font-semibold tracking-tight">{view === "ai" ? "Your review queue" : "Learn from completed delivery"}</h2><p className="mt-2 text-sm leading-6 text-estimator-muted">{view === "ai" ? "See which briefs need action from your team. Check the AI draft, confirm scope, then calculate effort." : "Compare committed plans with actual hours approved by another reviewer."}</p></div>
      <div role="group" aria-label="Review and results views" className="inline-flex shrink-0 self-start rounded-xl border border-estimator-line bg-white p-1">{([ ["ai", "Review queue"], ["delivery", "Delivery results"] ] as const).map(([id, title]) => <button key={id} type="button" aria-pressed={view === id} className={`min-h-10 rounded-lg px-3 text-sm font-medium transition ${view === id ? "bg-estimator-ink text-white" : "text-estimator-muted hover:bg-estimator-paper"}`} onClick={() => setView(id)}>{title}</button>)}</div>
    </div>
    {view === "ai" ? <>
      <dl aria-label="Workflow activity" className="flex flex-wrap gap-x-6 gap-y-2 text-xs leading-5 text-estimator-muted">{[["briefs analyzed", insights.analyzed], ["scopes approved in total", insights.approvedScopes], ["plans committed", insights.committed]].map(([title, value]) => <div key={title} className="flex gap-1.5"><dd className="font-semibold text-estimator-ink">{value}</dd><dt>{title}</dt></div>)}</dl>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Next steps" description="Open a brief to inspect its AI draft, review scope or commit the plan.">
          {insights.nextActions.length ? <div className="divide-y divide-estimator-line">{insights.nextActions.slice(0, 5).map(item => <article key={item.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{item.title}</h3><p className="mt-1.5 text-xs leading-5 text-estimator-muted">{item.tasks} draft tasks · {item.questions} open questions · {item.findings} AI findings to review</p></div><button className={secondary + " shrink-0 self-start sm:self-auto"} onClick={() => onOpenRequest(item.id, item.action)}>{item.action}<ArrowRight size={14}/></button></article>)}{insights.nextActions.length > 5 && <button className={secondary + " mt-4"} onClick={onOpenRequests}>View all requests<ArrowRight size={14}/></button>}</div> : <div className="py-5 text-center"><ClipboardList size={28} className="mx-auto text-estimator-muted"/><h3 className="mt-3 text-base font-semibold">{insights.processing ? "AI analysis is in progress" : insights.total ? "Your active reviews are complete" : "Start with a client brief"}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-estimator-muted">{insights.processing ? "Open client work to follow analysis progress. Briefs appear here when they need a decision." : insights.total ? "Track committed plans in Client work, or bring in the next client brief." : "Add a brief and its documents. AI will extract facts, consult approved knowledge and suggest a task plan for review."}</p><button className={button + " mt-4"} onClick={onOpenRequests}>Open client work<ArrowRight size={14}/></button></div>}
        </Card>
        <Card title="What your team reviewed" description={`${insights.findings.reviewed} of ${insights.findings.total} AI findings have a saved decision.`}>
          <dl className="space-y-3">{([ ["Accepted", insights.findings.accepted, "bg-emerald-500"], ["Corrected", insights.findings.corrected, "bg-violet-500"], ["Rejected", insights.findings.rejected, "bg-amber-500"] ] as const).map(([title, value, tone]) => <div key={title} className="flex items-center gap-2.5 text-sm"><span aria-hidden="true" className={`size-2 rounded-full ${tone}`}/><dt className="flex-1">{title}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
          <p className="mt-4 text-xs leading-6 text-estimator-muted">{insights.findings.reviewed ? "Corrections remain linked to the original AI findings for inspection." : "Review a request to accept, correct or reject its AI findings. Feedback appears here after you save it."}</p>
          <div className="mt-5 border-t border-estimator-line pt-4"><p className="text-xs font-medium text-estimator-muted">Evidence to inspect</p><p className="mt-2 text-sm"><strong>{insights.citedFacts} of {insights.totalFacts}</strong> extracted facts include a source quotation.</p><p className="mt-2 text-xs leading-6 text-estimator-muted">Check the cited passage in each request before accepting a finding.</p></div>
        </Card>
      </div>
      <details className="rounded-xl border border-estimator-line bg-estimator-paper p-4"><summary className="cursor-pointer text-sm font-medium">How the workflow fits together</summary><ol className="mt-4 grid gap-4 md:grid-cols-3">{[ ["01", "AI prepares a draft", `${insights.proposedTasks} task suggestions across analyzed briefs. Inspect the facts, product fit and questions alongside their sources.`], ["02", "Your team confirms scope", "Correct the suggestions and settle questions. Company task templates and reviewed delivery history then calculate effort."], ["03", "Commit, track and learn", "Save the approved plan, track tasks and record actual effort. A different teammate reviews delivery evidence."] ].map(([number, title, description]) => <li key={number} className="min-w-0"><p className="text-xs text-estimator-muted">{number}</p><h4 className="mt-1 text-sm font-semibold">{title}</h4><p className="mt-2 text-xs leading-6 text-estimator-muted">{description}</p></li>)}</ol></details>
      <p className="text-xs leading-6 text-estimator-muted">These counts describe workspace activity. Accuracy and improvement require independently reviewed delivery evidence.{publicDemo ? " This shared demo uses fictional requests with live AI analysis." : ""}</p>
    </> : <>
      <Card title="How close were your plans to delivery?" description="Compare a committed effort estimate with actual original-scope hours after a different reviewer approves the delivery evidence.">
        <dl className="mb-6 grid grid-cols-3 gap-3">{[["Committed plans", insights.committed], ["Awaiting review", evaluation.counts.pending], ["Evaluated deliveries", evaluation.recorded.n]].map(([title, value]) => <div key={title} className="min-w-0 rounded-xl bg-estimator-paper p-3"><dt className="text-xs leading-5 text-estimator-muted">{title}</dt><dd className="mt-1 text-2xl font-semibold">{value}</dd></div>)}</dl>
        {evaluation.recorded.n > 0 ? deliveryMetrics("recorded") : <div className="rounded-xl border border-dashed border-estimator-line px-5 py-8 text-center"><Target size={30} className="mx-auto text-estimator-muted"/><h3 className="mt-3 text-lg font-semibold">No delivery results yet</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-estimator-muted">After work is delivered, record actual hours against the committed tasks and attach evidence. A different teammate must approve the record before results appear.</p><button className={button + " mt-5"} onClick={() => committedRequest ? onOpenRequest(committedRequest.id, "Open a committed plan") : onOpenRequests()}>{committedRequest ? "Open a committed plan" : "Open client work"}<ArrowRight size={14}/></button><p className="mx-auto mt-4 max-w-xl text-xs leading-6 text-estimator-muted">Some projects are reserved for evaluation before delivery. Those results never tune the estimator. Demo projects are reported separately.</p></div>}
      </Card>
      {evaluation.synthetic.n > 0 && <details className="rounded-2xl border border-estimator-line bg-white p-5"><summary className="cursor-pointer text-sm font-semibold">Demo delivery results · {evaluation.synthetic.n} examples</summary><p className="mb-4 mt-3 text-xs leading-6 text-estimator-muted">Fictional examples exercise the workflow. Real delivery performance still needs recorded evidence.</p>{deliveryMetrics("synthetic")}</details>}
      <details className="rounded-2xl border border-estimator-line bg-white p-5"><summary className="cursor-pointer text-sm font-medium">Methodology & data export</summary><div className="mt-4 space-y-4"><p className="text-xs leading-6 text-estimator-muted">{evaluation.methodology}</p><p className="text-xs leading-6 text-estimator-muted">Committed: {evaluation.counts.frozen} · pending review: {evaluation.counts.pending} · rejected: {evaluation.counts.rejected} · excluded: {evaluation.counts.excluded} · reserved for training: {evaluation.counts.training}</p><ul className="list-disc space-y-2 pl-4 text-xs leading-6 text-estimator-muted">{evaluation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><div className="flex flex-wrap gap-3"><a className={secondary} href={"/api/company-workspace?company=" + company.id + "&view=export"}>Download evaluation records (JSONL)</a><a className={secondary} href={"/api/company-workspace?company=" + company.id + "&view=evaluation"}>Download metrics (JSON)</a></div></div></details>
    </>}
  </div>;
}

export function AuditPanel({ company, publicDemo = false }: { company: Company; publicDemo?: boolean }) {
  return <Card title="Organization audit trail">
    <p className="mb-4 text-sm text-[var(--muted)]">Latest 100 events. The API does not expose an audit deletion action.</p>
    {publicDemo && <p role="note" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">Anonymous visitors share one demo identity. These events show actions in the shared demo, not which visitor performed each action.</p>}
    <ul className="space-y-3">{company.audit.map(event => <li className="break-words rounded-xl border border-[var(--line)] p-4 text-xs leading-6 [overflow-wrap:anywhere]" key={event.id}><strong>{event.action}</strong><p>{new Date(event.createdAt).toLocaleString()} · actor {event.actor}</p>{event.requestId && <p>Request {event.requestId}</p>}</li>)}</ul>
  </Card>;
}
