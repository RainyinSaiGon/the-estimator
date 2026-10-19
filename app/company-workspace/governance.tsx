"use client";

import { useState, type ReactNode } from "react";
import type { ClientRequest, Company, CompanyRole, WorkspaceResponse } from "../../lib/client-workflow-types";
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

export function EvaluationPanel({ company, publicDemo = false }: { company: Company; publicDemo?: boolean }) {
  const evaluation = company.evaluation;
  return <div className="grid gap-5 md:grid-cols-2">
    {publicDemo && <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950 md:col-span-2">New requests in this public demo are always synthetic. No real client delivery outcomes are supplied here, so this page must not be used to claim real estimate accuracy.</p>}
    <Card className="md:col-span-2" title="Declared delivery holdout">
      <p className="text-sm leading-7 text-[var(--muted)]">{evaluation.methodology}</p>
      <div className="mt-4 flex flex-wrap gap-3"><a className={secondary} href={"/api/company-workspace?company=" + company.id + "&view=export"}>Export reproducible JSONL</a><a className={secondary} href={"/api/company-workspace?company=" + company.id + "&view=evaluation"}>Download metrics JSON</a></div>
      <p className="mt-4 text-xs">Frozen: {evaluation.counts.frozen} · pending: {evaluation.counts.pending} · rejected: {evaluation.counts.rejected} · excluded: {evaluation.counts.excluded} · training excluded: {evaluation.counts.training}</p>
      <ul className="mt-4 list-inside list-disc space-y-2 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">{evaluation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    </Card>
    {(["recorded", "synthetic"] as const).map(cohort => {
      const metrics = evaluation[cohort];
      const rows: Array<[string, string]> = [
        ["Base mean absolute error", metrics.baseMAEHours == null ? "Unavailable" : metrics.baseMAEHours + " h"],
        ["Adjusted mean absolute error", metrics.adjustedMAEHours == null ? "Unavailable" : metrics.adjustedMAEHours + " h"],
        ["Signed bias (prediction − actual)", metrics.signedBiasHours == null ? "Unavailable" : metrics.signedBiasHours + " h"],
        ["Observed range coverage", metrics.rangeCoverage == null ? "Unavailable" : (metrics.rangeCoverage * 100).toFixed(1) + "%"],
      ];
      return <Card key={cohort} title={(cohort === "recorded" ? "Recorded" : "Synthetic") + " holdout · n=" + metrics.n}>
        <dl className="grid gap-3 text-sm md:grid-cols-2">{rows.map(([label, value]) => <div className="rounded-xl bg-[var(--paper)] p-3" key={label}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl>
        <p className="mt-4 text-xs">Work domains: {Object.entries(metrics.domains).map(([domain, count]) => domain + ": " + count).join(" · ") || "No eligible outcomes"}</p>
      </Card>;
    })}
  </div>;
}

export function AuditPanel({ company, publicDemo = false }: { company: Company; publicDemo?: boolean }) {
  return <Card title="Organization audit trail">
    <p className="mb-4 text-sm text-[var(--muted)]">Latest 100 events. The API does not expose an audit deletion action.</p>
    {publicDemo && <p role="note" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">Anonymous visitors share one demo identity. These events show actions in the shared demo, not which visitor performed each action.</p>}
    <ul className="space-y-3">{company.audit.map(event => <li className="break-words rounded-xl border border-[var(--line)] p-4 text-xs leading-6 [overflow-wrap:anywhere]" key={event.id}><strong>{event.action}</strong><p>{new Date(event.createdAt).toLocaleString()} · actor {event.actor}</p>{event.requestId && <p>Request {event.requestId}</p>}</li>)}</ul>
  </Card>;
}
