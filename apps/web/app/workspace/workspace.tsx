"use client";

import Link from "next/link";
import { ArrowLeft, Settings2 } from "lucide-react";
import { DeliverySchedulePanel } from "../../../../components/delivery-schedule";
import { CommitmentChanges } from "./commitment-changes";
import { ScopeDecisions, unresolvedScopeDecisions } from "./review-decisions";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { IdentityAccount } from "../../lib/identity";
import { requestTypes, type Attachment, type ClientRequest, type Company, type CompanySummary, type Configuration, type EstimateTask, type Passage, type ScopeReview, type TaskTracking, type TaskTrackingStatus, type WorkPackage } from "../../lib/workflow-types";
import { anduinReference } from "../../lib/reference-profiles";

const button = "rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40";
const secondary = "rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm";
const card = "rounded-2xl border border-[var(--line)] bg-white p-5";
const label = "block text-xs font-medium text-[var(--muted)]";
const formats = ".pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,.json,.eml";
const number = (value: number) => Number(value.toFixed(1)).toLocaleString();
function Field({ name, children }: { name: string; children: ReactNode }) { return <label className={label}>{name}{children}</label>; }
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className={card}><h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}</section>; }
function proposedFields(request: ClientRequest, config: Configuration): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const fact of request.analysis?.facts || []) {
    if (fact.status !== "source" || !fact.value.trim()) continue;
    const field = config.fields.find(item => item.key === fact.key);
    if (!field) continue;
    if (field.type === "number") {
      const value = Number(fact.value);
      if (Number.isFinite(value) && value >= 0) fields[fact.key] = value;
    } else if (field.type === "boolean") {
      const value = fact.value.trim().toLowerCase();
      if (["true", "yes", "1"].includes(value)) fields[fact.key] = true;
      else if (["false", "no", "0"].includes(value)) fields[fact.key] = false;
    } else if (field.type === "enum") {
      const value = field.options?.find(option => option.toLowerCase() === fact.value.trim().toLowerCase());
      if (value) fields[fact.key] = value;
    } else fields[fact.key] = fact.value;
  }
  return fields;
}
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/workflow/" + path, { ...init, cache: "no-store", headers: { ...(!(init.body instanceof FormData) && init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "The workspace request failed.";
    throw new Error(message);
  }
  return data as T;
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Panel = "requests" | "knowledge" | "settings" | "members" | "connectors" | "evaluation" | "audit";
export default function CompanyWorkspace({ account }: { account: IdentityAccount }) {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [panel, setPanel] = useState<Panel>("requests");
  const [selected, setSelected] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newRequest, setNewRequest] = useState(false);
  const loadCompany = useCallback(async (id: string) => {
    const data = await api<Company>("companies/" + id); setCompany(data);
    const url = new URL(window.location.href); url.searchParams.set("company", id); window.history.replaceState(null, "", url);
  }, []);
  const loadCompanies = useCallback(async () => {
    const result = await api<{ companies: CompanySummary[] }>("companies"); setCompanies(result.companies);
    const url = new URL(window.location.href); const id = url.searchParams.get("company") || result.companies[0]?.id;
    const tab = url.searchParams.get("tab"); if (["requests", "knowledge", "settings", "members", "connectors", "evaluation", "audit"].includes(tab || "")) setPanel(tab as Panel);
    if (id && result.companies.some(item => item.id === id)) await loadCompany(id);
  }, [loadCompany]);
  useEffect(() => { void Promise.resolve().then(loadCompanies).catch(cause => setError(cause.message)); }, [loadCompanies]);
  useEffect(() => {
    if (!company?.id) return;
    const timer = setInterval(() => { void api<Company>("companies/" + company.id).then(setCompany).catch(() => undefined); }, 20000);
    return () => clearInterval(timer);
  }, [company?.id]);
  async function run<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
    setBusy(name); setError(""); setNotice("");
    try { return await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); return undefined; } finally { setBusy(""); }
  }
  async function action(body: Record<string, unknown>) {
    if (!company) throw new Error("Choose a company.");
    const result = await api<{ company: Company; objectId: string }>(`companies/${company.id}/actions`, { method: "POST", body: JSON.stringify({ ...body, expectedVersion: company.version }) });
    setCompany(result.company); return result;
  }
  function openPanel(next: Panel) {
    setPanel(next);
    const url = new URL(window.location.href);
    if (next === "requests") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }
  const request = company?.requests.find(item => item.id === selected);
  const filteredRequests = (company?.requests || []).filter(item => `${item.title} ${item.channel} ${item.status}`.toLowerCase().includes(requestSearch.toLowerCase()));
  return <main className="mx-auto min-h-screen max-w-7xl px-5 py-7 md:px-10">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
      <Link href="/" className="font-semibold">The Estimator</Link>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Company workspace" className="max-w-64 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" value={company?.id || ""} onChange={event => { setSelected(""); void run("load", () => loadCompany(event.target.value)); }}><option value="">Choose a company</option>{companies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select>
        <button className={secondary} onClick={() => setCreating(!creating)}>New company</button>
        <Link className="text-sm underline" href="/account">{account.displayName}</Link>
      </div>
    </header>
    {(creating || companies.length === 0) && <form className={card + " mb-6 max-w-xl"} onSubmit={event => { event.preventDefault(); void run("company", async () => { const result = await api<Company>("companies", { method: "POST", body: JSON.stringify({ name: companyName }) }); setCompany(result); setCompanies(items => [...items, { id: result.id, name: result.name, version: result.version, role: "admin" }]); setCreating(false); setCompanyName(""); openPanel("settings"); }); }}>
      <h1 className="text-2xl font-medium">Create a company workspace</h1><p className="mt-2 text-sm text-[var(--muted)]">Configure your products, required intake information, approved knowledge, and task assumptions. Your company controls access to its requests.</p>
      <Field name="Company name"><input className={input} minLength={2} maxLength={120} value={companyName} required onChange={event => setCompanyName(event.target.value)} /></Field><button className={button + " mt-4"} disabled={!!busy}>Create workspace</button>
    </form>}
    {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {notice && <p role="status" className="mb-5 rounded-xl bg-green-50 p-4 text-sm text-green-900">{notice}</p>}
    {company && <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{company.role} workspace</p><h1 className="mt-1 text-3xl font-medium">{company.name}</h1></div><Link href="/estimate" className="text-xs text-[var(--muted)] underline">AI brief demo</Link></div>
      <nav aria-label="Company sections" className="mb-7 flex flex-wrap items-center gap-1 border-b border-[var(--line)]">
        {(["requests", "evaluation"] as Panel[]).map(item => <button key={item} aria-current={panel === item ? "page" : undefined} className={(panel === item ? "border-b-2 border-[var(--ink)] text-[var(--ink)]" : "border-b-2 border-transparent text-[var(--muted)]") + " px-4 py-3 text-sm font-medium capitalize"} onClick={() => openPanel(item)}>{item === "requests" ? "Requests" : "Evaluate"}</button>)}
        <details className="relative ml-auto pb-1">
          <summary aria-label="Workspace settings" title="Workspace settings" className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--ink)]"><Settings2 aria-hidden="true" size={16} />Workspace settings</summary>
          <div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-[var(--line)] bg-white p-2 shadow-xl" aria-label="Workspace settings">
            {([ ["knowledge", "Approved knowledge"], ["settings", "Company settings"], ["members", "Members and roles"], ["connectors", "Connectors"], ["audit", "Audit history"] ] as [Panel, string][]).map(([item, label]) => <button key={item} className="block w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[var(--paper)]" onClick={event => { openPanel(item); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{label}</button>)}
          </div>
        </details>
      </nav>
      {busy && <p className="mb-4 text-sm text-[var(--muted)]" role="status">{busy === "analyze" ? "Analyzing source facts and approved knowledge…" : "Saving or loading…"}</p>}
      {panel === "requests" && <div className="space-y-6">
        {!selected && !newRequest && <aside className="space-y-3">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Requests</h2><p className="mt-1 text-xs text-[var(--muted)]">{company.requests.length} total · {company.requests.filter(item => !["delivery_review", "completed"].includes(item.status)).length} active</p></div><button className={button} onClick={() => { setNewRequest(true); setSelected(""); }}>New request</button></div>
          <p className="text-xs leading-5 text-[var(--muted)]">Email, form, and uploaded requests appear here. Replies update the request and invalidate its scope approval.</p>
          <label className={label}>Search requests<input className={input} type="search" value={requestSearch} placeholder="Name, channel, or status" onChange={event => setRequestSearch(event.target.value)} /></label>
          <p className="text-xs text-[var(--muted)]">Showing {filteredRequests.length} of {company.requests.length}</p>
          {company.requests.length === 0 && <p className={card + " text-sm"}>No requests yet. Add client material or connect a mailbox.</p>}
          {filteredRequests.map(item => <button key={item.id} className={card + " w-full text-left transition hover:border-[var(--ink)] " + (selected === item.id ? "border-[var(--ink)] bg-[var(--paper)] ring-1 ring-[var(--ink)]" : "")} onClick={() => { setNewRequest(false); setSelected(item.id); }}><strong className="block text-sm">{item.title}</strong><span className="mt-2 block text-xs capitalize text-[var(--muted)]">{item.status.replaceAll("_", " ")} · {item.channel}</span><span className="mt-2 block text-[11px] text-[var(--muted)]">Received {new Date(item.createdAt).toLocaleDateString()}</span></button>)}
        </aside>}
        <div className="min-w-0 space-y-5">
          {(selected || newRequest) && <button type="button" className={secondary + " inline-flex items-center gap-2"} onClick={() => { setSelected(""); setNewRequest(false); }}><ArrowLeft size={16} />Back to requests</button>}
          {newRequest && <RequestIntake busy={!!busy} submit={form => run("receive", async () => { const result = await api<{ company: Company; objectId: string }>(`companies/${company.id}/intake`, { method: "POST", body: form }); setCompany(result.company); setSelected(result.objectId); setNewRequest(false); setNotice("Request received. AI analysis will run in the background, or choose Analyze now."); })} />}
          {request && <RequestDetail key={request.id + ":" + request.updatedAt} company={company} request={request} accountId={account.accountId} busy={!!busy}
            action={body => run(String(body.action), () => action({ ...body, requestId: request.id }))}
            analyze={() => run("analyze", async () => { const result = await api<{ company: Company }>(`companies/${company.id}/analyze/${request.id}`, { method: "POST" }); setCompany(result.company); })}
          />}
          {!request && !newRequest && <Section title="From request to reviewed estimate"><p className="text-sm leading-7 text-[var(--muted)]">Receive client material, inspect source facts and approved product knowledge, review the scope, then calculate task effort. Frozen baselines preserve the agreed scope for delivery review and evaluation.</p></Section>}
        </div>
      </div>}
      {panel === "knowledge" && <KnowledgePanel company={company} busy={!!busy} action={body => run(String(body.action), () => action(body))} request={async (path, body) => run("knowledge", async () => { const result = await api<{ company: Company }>(`companies/${company.id}/knowledge/${path}`, { method: "POST", body }); setCompany(result.company); })} />}
      {panel === "settings" && <CompanySettings key={company.id + ":" + company.config.version} company={company} accountId={account.accountId} busy={!!busy} save={config => run("configuration", () => action({ action: "config", config }))} action={body => run(String(body.action), () => action(body))} deleted={() => { setCompany(null); void loadCompanies(); }} />}
      {panel === "members" && <MembersPanel company={company} busy={!!busy} action={body => run(String(body.action), () => action(body))} />}
      {panel === "connectors" && <Connectors company={company} busy={!!busy} action={body => run(String(body.action), () => action(body))} request={path => run("connector", async () => { const result = await api<Record<string, unknown>>(`companies/${company.id}/${path}`, { method: "POST" }); await loadCompany(company.id); setNotice("Connector operation completed."); return result; })} />}
      {panel === "evaluation" && <Evaluation company={company} />}
      {panel === "audit" && <Section title="Change and approval history"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Time</th><th className="p-2">Action</th><th className="p-2">Actor account</th><th className="p-2">Record</th></tr></thead><tbody>{company.audit.slice(-200).reverse().map((item, index) => <tr key={index} className="border-t border-[var(--line)]"><td className="p-2">{new Date(item.at).toLocaleString()}</td><td className="p-2">{item.action}</td><td className="p-2 font-mono">{item.actor}</td><td className="p-2 font-mono">{item.objectId}</td></tr>)}</tbody></table></div></Section>}
    </>}
  </main>;
}

function RequestIntake({ busy, submit }: { busy: boolean; submit: (form: FormData) => unknown }) {
  return <Section title="Receive request and attachments"><form className="space-y-4" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    <Field name="Request title"><input name="title" className={input} required minLength={3} maxLength={200} /></Field>
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] p-4"><label htmlFor="request-files" className="text-sm font-semibold">Upload client documents</label><p className="mt-1 text-xs leading-5 text-[var(--muted)]">PDF, Word (.docx), Excel (.xlsx), PowerPoint, CSV, text, Markdown, JSON, or email. Up to 10 files, 10 MB each, 20 MB total.</p><input id="request-files" name="files" type="file" accept={formats} multiple className="mt-3 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-[var(--ink)] file:px-4 file:py-2 file:text-white" /></div>
    <Field name="Message or pasted brief (optional when a document contains the request)"><textarea name="text" rows={7} maxLength={100000} className={input} /></Field>
    <p className="text-xs leading-5 text-[var(--muted)]">AI receives the extracted request text, your configured company profile, and relevant approved knowledge. Use material you are authorized to share with the provider. Extracted sources and analysis are retained for the company’s configured period.</p><button disabled={busy} className={button}>Receive request</button>
  </form></Section>;
}

type ActionResult = { company: Company; objectId: string } | undefined;
type RequestStage = "intake" | "scope" | "effort" | "commitment";
function RequestDetail({ company, request, accountId, busy, action, analyze }: { company: Company; request: ClientRequest; accountId: string; busy: boolean; action: (body: Record<string, unknown>) => Promise<ActionResult>; analyze: () => unknown }) {
  const analysis = request.analysis;
  const savedReview = request.review;
  const hasSavedReviewDraft = !!savedReview.configVersion || !!savedReview.confirmed || Object.keys(savedReview.fields || {}).length > 0 || !!savedReview.deliverables || !!savedReview.acceptance || (savedReview.workPackages?.length || 0) > 0;
  const [review, setReview] = useState<ScopeReview>(() => ({ ...savedReview, requestType: savedReview?.requestType || analysis?.requestType || "demo", productId: savedReview?.productId || analysis?.productId || "", deliverables: savedReview?.deliverables || analysis?.deliverables || "", exclusions: savedReview?.exclusions || analysis?.exclusions || "", acceptance: savedReview?.acceptance || analysis?.acceptance || "", dependencies: savedReview?.dependencies || analysis?.dependencies || "", confirmed: savedReview?.confirmed || false, confirmedBy: savedReview?.confirmedBy || "", fields: { ...(hasSavedReviewDraft ? {} : proposedFields(request, company.config)), ...(savedReview?.fields ?? {}) }, questions: hasSavedReviewDraft ? savedReview?.questions ?? [] : analysis?.questions ?? [], workPackages: hasSavedReviewDraft ? savedReview?.workPackages ?? [] : analysis?.workPackages ?? [] }));
  const [dirty, setDirty] = useState(false);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [reviewer, setReviewer] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [additional, setAdditional] = useState("0");
  const [source, setSource] = useState("timesheet");
  const [reference, setReference] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  const [note, setNote] = useState("");
  const [sourceEdit, setSourceEdit] = useState(false);
  const [messageText, setMessageText] = useState(request.text);
  const [limitationsAccepted, setLimitationsAccepted] = useState(false);
  const [staffCount,setStaffCount]=useState(""),[dependencyDays,setDependencyDays]=useState("0"),[startDate,setStartDate]=useState("");
  const baseline = request.baselines.at(-1);
  const outcome = request.deliveryOutcome;
  const [stage, setStage] = useState<RequestStage>(() => outcome || baseline ? "commitment" : request.estimate || request.review.confirmed ? "effort" : "intake");
  const isLimited = request.attachments.some(file => file.status !== "extracted" || file.truncated);
  const unresolved = analysis ? unresolvedScopeDecisions(analysis, review) : [];
  const edit = (patch: Partial<ScopeReview>) => { setDirty(true); setReview(current => {
    const next = { ...current, ...patch, confirmed: false };
    if (patch.questions) {
      const retained = new Set([...(analysis?.questions ?? []), ...patch.questions]);
      next.questionResolutions = Object.fromEntries(Object.entries(next.questionResolutions ?? {}).filter(([key]) => retained.has(key)));
    }
    return next;
  }); };
  const updatePackage = (index: number, patch: Partial<WorkPackage>) => edit({ workPackages: review.workPackages.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const stageDefinitions: { id: RequestStage; label: string; complete: boolean; available: boolean }[] = [
    { id: "intake", label: "Request & evidence", complete: !!analysis, available: true },
    { id: "scope", label: "Review scope", complete: !!request.review.confirmed && !dirty, available: !!analysis },
    { id: "effort", label: "Effort plan", complete: !!request.estimate && !dirty, available: !!request.review.confirmed && !dirty },
    { id: "commitment", label: "Commit & track", complete: !!baseline, available: !!baseline },
  ];
  return <>
    <div className="rounded-2xl border border-[var(--line)] bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Client request · {request.channel}</p><h2 className="mt-1 text-xl font-semibold">{request.title}</h2></div><span className="rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs capitalize text-[var(--muted)]">{request.status.replaceAll("_", " ")}</span></div>
      <nav aria-label="Request progress" className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{stageDefinitions.map((item, index) => <button key={item.id} type="button" disabled={!item.available} aria-current={stage === item.id ? "step" : undefined} className={(stage === item.id ? "border-[var(--ink)] bg-[var(--ink)] text-white" : item.complete ? "border-emerald-200 bg-emerald-50 text-[var(--ink)]" : "border-[var(--line)] bg-white text-[var(--muted)]") + " rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50"} onClick={() => setStage(item.id)}><span className="flex items-center gap-2 text-xs font-semibold"><span className="flex size-6 items-center justify-center rounded-full border border-current">{item.complete && stage !== item.id ? "✓" : index + 1}</span>{item.label}</span><span className="mt-1 block pl-8 text-[11px] opacity-80">{stage === item.id ? "Current step" : item.complete ? "Complete" : item.available ? "Ready when you are" : "Complete the previous step first"}</span></button>)}</nav>
    </div>
    {stage === "intake" && <Section title="Request and source evidence">
      <p className="text-xs text-[var(--muted)]">{request.channel} · revision {request.revision} · {request.status.replaceAll("_", " ")} · received {new Date(request.createdAt).toLocaleString()}</p>
      {request.lastError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">{request.lastError}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy || !!outcome || request.status === "analyzing"} onClick={() => analyze()}>{analysis ? "Analyze again" : "Analyze now"}</button><button className={secondary} disabled={!!outcome} onClick={() => setSourceEdit(!sourceEdit)}>Correct source message</button>{company.role === "admin" && <button className={secondary} onClick={() => { if (window.confirm("Delete this request and its stored evidence?")) void action({ action: "request.delete" }); }}>Delete request</button>}</div>
      {sourceEdit && <div className="mt-4"><textarea className={input} rows={7} value={messageText} onChange={event => setMessageText(event.target.value)} /><button className={secondary + " mt-2"} disabled={busy} onClick={() => action({ action: "request.update", title: request.title, text: messageText })}>Save a new source revision</button></div>}
      <details className="mt-4 rounded-xl bg-[var(--paper)] p-4"><summary className="cursor-pointer text-sm font-medium">Original source and extraction status</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6">{request.text || "No message body supplied."}</pre>{request.attachments.map(file => <div key={file.id}><AttachmentView attachment={file} />{file.sha256 && <a className="mt-2 inline-flex text-xs underline" href={`/api/workflow/companies/${company.id}/attachments/${file.id}`} download={file.name}>Download original {file.name}</a>}</div>)}</details>
    </Section>}
    {stage === "intake" && analysis && <Section title="AI analysis and proposed work"><p className="text-sm leading-7">{analysis.summary}</p><p className="mt-2 text-xs text-[var(--muted)]">{analysis.run.model} · {analysis.run.steps.join(" → ")}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{analysis.facts.map((fact, index) => <div key={index} className="rounded-xl bg-[var(--paper)] p-3"><p className="text-xs font-semibold">{company.config.fields.find(field => field.key === fact.key)?.label || fact.key} · {fact.status}</p><p className="mt-1 text-sm">{fact.value || "Unknown"}</p>{fact.evidence && <blockquote className="mt-2 text-xs leading-5 text-[var(--muted)]">“{fact.evidence}” · {fact.sourceName}</blockquote>}</div>)}</div>
      {analysis.productFindings.map((finding, index) => { const citation = request.knowledge.find(item => item.sourceId === finding.sourceId); return <div key={index} className="mt-3 rounded-xl border border-[var(--line)] p-3"><p className="text-sm font-medium">{company.config.products.find(product => product.id === finding.productId)?.name} · {finding.status}</p><p className="mt-1 text-xs leading-6">{finding.explanation}</p>{citation && <p className="mt-2 text-xs">“{finding.evidence}” · {citation.url ? <a className="underline" target="_blank" rel="noreferrer" href={citation.url}>{citation.title}</a> : citation.title} · retrieved {new Date(citation.retrievedAt).toLocaleDateString()}</p>}</div>; })}
      {[["Assumptions to review", analysis.assumptions], ["Conflicts", analysis.conflicts], ["Clarification questions", analysis.questions]].map(([heading, items]) => <div key={heading as string} className="mt-4"><h3 className="text-sm font-semibold">{heading as string}</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm">{(items as string[]).map((text, index) => <li key={index}>{text}</li>)}</ul></div>)}
      <p className="mt-4 text-xs text-[var(--muted)]">{analysis.sourceCheck}</p>
      <h3 className="mt-5 text-sm font-semibold">Team capability fit</h3>{!company.config.capabilities.length && <p className="mt-2 text-xs">No verified team profile was supplied. Delivery capability and availability remain unknown.</p>}{analysis.capabilityFindings?.map((finding,index)=><p key={index} className="mt-2 rounded-xl bg-[var(--paper)] p-3 text-xs leading-6"><strong>{finding.capability} · {finding.status}</strong><br />{finding.explanation}{finding.evidence&&<span className="block">Profile evidence: “{finding.evidence}”</span>}</p>)}
      <div className="mt-6 border-t border-[var(--line)] pt-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-base font-semibold">AI-proposed work breakdown</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">Suggestions are provisional. Confirm or edit each task before the estimator calculates effort; AI does not provide hours.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">Needs human review</span></div>
        {analysis.workPackages.length ? <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-[var(--paper)] text-xs text-[var(--muted)]"><tr><th className="p-3">Proposed task</th><th className="p-3">Task template</th><th className="p-3">Units</th><th className="p-3">Owner</th><th className="p-3">Basis</th></tr></thead><tbody>{analysis.workPackages.map(work => { const template = company.config.tasks.find(task => task.id === work.taskId); return <tr key={work.id} className="border-t border-[var(--line)] align-top"><td className="p-3 font-medium">{work.title}<details className="mt-1 text-xs font-normal text-[var(--muted)]"><summary className="cursor-pointer">Completion and dependency notes</summary><p className="mt-2">Done when: {work.acceptance || "Confirm during scope review."}</p><p className="mt-1">Depends on: {work.dependencies || "No dependency stated."}</p></details></td><td className="p-3">{template?.label || work.taskId}</td><td className="p-3">{number(work.quantity)}</td><td className="p-3 capitalize">{work.owner}</td><td className="p-3">{work.basis === "source" && work.evidence ? <details><summary className="cursor-pointer text-xs">Source-backed</summary><blockquote className="mt-2 max-w-xs text-xs leading-5 text-[var(--muted)]">“{work.evidence}”<span className="mt-1 block">{work.sourceName}</span></blockquote></details> : <span className="text-xs text-[var(--muted)]">Inferred · verify</span>}</td></tr>; })}</tbody></table></div> : <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">No implementation tasks were suggested. Resolve the clarification questions before estimating this inquiry.</p>}
        <button className={button + " mt-4"} onClick={() => setStage("scope")}>Review scope and tasks</button>
      </div>
    </Section>}
    {stage === "scope" && analysis && <><Section title="Review AI findings"><p className="mb-4 text-sm leading-6">{analysis.summary}</p><ScopeDecisions analysis={analysis} review={review} disabled={!!outcome || busy} onChange={edit} /></Section><Section title="Confirm deliverables and scope"><div className="grid gap-4 md:grid-cols-2">
      <Field name="Request classification"><select disabled={!!outcome} className={input} value={review.requestType || "demo"} onChange={event => edit({ requestType: event.target.value as ScopeReview["requestType"] })}>{requestTypes.map(type => <option key={type}>{type}</option>)}</select></Field>
      <Field name="Product fit"><select disabled={!!outcome} className={input} value={review.productId || ""} onChange={event => edit({ productId: event.target.value })}><option value="">Unconfirmed or no product selected</option>{company.config.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
      {company.config.fields.filter(field => !field.requestTypes?.length || field.requestTypes.includes(review.requestType)).map(field => <Field key={field.key} name={field.label + (field.required ? " *" : "")}>
        {field.type === "boolean" ? <select disabled={!!outcome} className={input} value={review.fields[field.key] === undefined ? "" : String(review.fields[field.key])} onChange={event => edit({ fields: { ...review.fields, [field.key]: event.target.value === "" ? null : event.target.value === "true" } })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select> :
          field.type === "enum" ? <select disabled={!!outcome} className={input} value={String(review.fields[field.key] ?? "")} onChange={event => edit({ fields: { ...review.fields, [field.key]: event.target.value } })}><option value="">Unknown</option>{field.options?.map(value => <option key={value}>{value}</option>)}</select> :
          <input disabled={!!outcome} className={input} type={field.type === "number" ? "number" : "text"} min={field.type === "number" ? 0 : undefined} value={String(review.fields[field.key] ?? "")} onChange={event => edit({ fields: { ...review.fields, [field.key]: field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value } })} />}
      </Field>)}
      {(["deliverables", "exclusions", "acceptance", "dependencies"] as const).map(key => <Field key={key} name={{ deliverables: "Agreed deliverables", exclusions: "Explicit exclusions", acceptance: "Definition of done and acceptance criteria", dependencies: "Dependencies and owners" }[key]}><textarea disabled={!!outcome} className={input} rows={3} value={review[key] || ""} onChange={event => edit({ [key]: event.target.value })} /></Field>)}
      <Field name="Clarification questions (one per line)"><textarea disabled={!!outcome} className={input} rows={4} value={review.questions.join("\n")} onChange={event => edit({ questions: event.target.value.split("\n") })} /></Field>
    </div>
    <h3 className="mt-6 text-sm font-semibold">Work packages and completion criteria</h3>
    {company.config.tasks.length === 0 && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm">An administrator must configure task templates and planning priors before this request can be estimated.</p>}
    <div className="mt-3 space-y-3">{review.workPackages.map((work, index) => <div className="rounded-xl bg-[var(--paper)] p-4" key={work.id}><div className="grid gap-3 md:grid-cols-2">
      <Field name="Task template"><select disabled={!!outcome} className={input} value={work.taskId} onChange={event => updatePackage(index, { taskId: event.target.value })}><option value="">Choose a task</option>{company.config.tasks.filter(task => !task.requestTypes?.length || task.requestTypes.includes(review.requestType)).map(task => <option key={task.id} value={task.id}>{task.label}</option>)}</select></Field>
      <Field name="Work item"><input disabled={!!outcome} className={input} value={work.title} onChange={event => updatePackage(index, { title: event.target.value })} /></Field>
      <Field name="Quantity of template units"><input disabled={!!outcome} type="number" min=".1" step=".1" className={input} value={work.quantity} onChange={event => updatePackage(index, { quantity: Number(event.target.value) })} /></Field>
      <Field name="Owner"><select disabled={!!outcome} className={input} value={work.owner} onChange={event => updatePackage(index, { owner: event.target.value as WorkPackage["owner"] })}><option value="company">Our company</option><option value="customer">Customer</option><option value="vendor">Vendor</option></select></Field>
      <Field name="Completion criteria"><textarea disabled={!!outcome} className={input} value={work.acceptance} onChange={event => updatePackage(index, { acceptance: event.target.value })} /></Field><Field name="Prerequisites"><textarea disabled={!!outcome} className={input} value={work.dependencies} onChange={event => updatePackage(index, { dependencies: event.target.value })} /></Field>
      <details className="mt-3 text-xs text-[var(--muted)]"><summary className="cursor-pointer">Suggestion basis</summary><p className="mt-2">{work.basis === "source" && work.evidence ? `Source quote from ${work.sourceName}: “${work.evidence}”` : "AI inference; confirm this task matches the request."}</p></details>
    </div>{!outcome && <button className="mt-2 text-xs underline" onClick={() => edit({ workPackages: review.workPackages.filter((_, i) => i !== index) })}>Remove work package</button>}</div>)}</div>
      {!outcome && <><button className={secondary + " mt-3"} onClick={() => edit({ workPackages: [...review.workPackages, { id: crypto.randomUUID(), taskId: company.config.tasks.find(task => !task.requestTypes?.length || task.requestTypes.includes(review.requestType))?.id || "", title: "", quantity: 1, owner: "company", acceptance: "", dependencies: "", basis: "inference", sourceName: "", evidence: "" }] })}>Add work package</button>
      {isLimited && <label className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm"><input type="checkbox" checked={limitationsAccepted} onChange={event => setLimitationsAccepted(event.target.checked)} />I reviewed the extraction failures or truncation and have reconciled the scope against the original material.</label>}
      <div className="mt-5 flex flex-wrap gap-2"><button disabled={busy} className={secondary} onClick={() => action({ action: "review", review: { ...review, confirmed: false, sourceLimitationsAccepted: limitationsAccepted } })}>Save review draft</button><button disabled={busy || unresolved.length > 0 || (isLimited && !limitationsAccepted)} className={button} onClick={async () => { const saved = await action({ action: "review", review: { ...review, confirmed: true, sourceLimitationsAccepted: limitationsAccepted } }); if (saved) setStage("effort"); }}>Confirm scope and continue</button></div>
      <p className="mt-3 text-xs text-[var(--muted)]">Human corrections are saved separately from the AI suggestions. Required fields, completion criteria, and original questions and conflicts are checked before confirmation. {unresolved.length > 0 && `${unresolved.length} decision(s) still need an answer or reason of at least 10 characters.`}</p>
    </>}
    </Section></>}
    {stage === "effort" && request.review.confirmed && !dirty && <Section title="Effort plan">
      <div className="mb-4 grid gap-3 md:grid-cols-3"><Field name="Allocated people (optional calendar scenario)"><input className={input} type="number" min=".1" step=".1" value={staffCount} placeholder="Leave blank when availability is unknown" onChange={event=>setStaffCount(event.target.value)} /></Field><Field name="Known dependency delay in working days"><input className={input} type="number" min="0" step=".5" value={dependencyDays} onChange={event=>setDependencyDays(event.target.value)} /></Field><Field name="Planned start date (optional)"><input className={input} type="date" value={startDate} onChange={event=>setStartDate(event.target.value)} /></Field></div>
      {!request.estimate && <p className="mb-3 rounded-xl bg-[var(--paper)] p-3 text-sm text-[var(--muted)]">Scope is confirmed. Calculate per-task effort from company priors and eligible delivery history.</p>}
      <button disabled={busy || !!outcome} className={button} onClick={() => action({ action: "estimate",staffCount:Number(staffCount||0),dependencyDays:Number(dependencyDays||0),startDate })}>{request.estimate ? "Update effort and schedule scenario" : "Calculate effort"}</button>
      {request.estimate && <><div className="mt-4 grid grid-cols-3 gap-3">{[["Low", request.estimate.low], ["Central", request.estimate.hours], ["High", request.estimate.high]].map(([name, hours]) => <div key={name} className="rounded-xl bg-[var(--paper)] p-4"><p className="text-xs text-[var(--muted)]">{name}</p><p className="mt-1 text-xl">{number(hours as number)} h</p></div>)}</div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[var(--paper)] text-xs text-[var(--muted)]"><tr>{["Task", "Low", "Central", "High", "Approved examples", "Calculation"].map(name => <th className="p-3" key={name}>{name}</th>)}</tr></thead><tbody>{request.estimate.tasks.map(task => <tr key={task.category} className="border-t border-[var(--line)]"><td className="p-3 font-medium">{task.label}{task.hours > (company.config.taskSizeGuidelineHours || 16) && <p className="mt-1 text-xs text-amber-900">Consider splitting: above your {company.config.taskSizeGuidelineHours || 16} h sizing guideline.</p>}</td><td className="p-3">{number(task.low)} h</td><td className="p-3 font-semibold">{number(task.hours)} h</td><td className="p-3">{number(task.high)} h</td><td className="p-3">{task.observations > 0 ? task.observations : "No history"}{task.referenceIds?.length > 0 && <details className="mt-1 text-xs"><summary className="cursor-pointer">View references</summary><p className="mt-1 break-all text-[var(--muted)]">{task.referenceIds.join(", ")}</p></details>}</td><td className="p-3"><details className="text-xs"><summary className="cursor-pointer">Basis</summary><p className="mt-1 text-[var(--muted)]">Configured base: {number(task.base)} h · historical factor: {task.factor.toFixed(2)}</p></details></td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs leading-6 text-[var(--muted)]">{request.estimate.limitation} Only independently approved, recorded training deliveries for the same request type, product, and task can adjust the configured prior. Added scope is excluded.</p>
        {request.estimate.planningDays && <p className="mt-3 rounded-xl bg-[var(--paper)] p-3 text-xs leading-6">Planning scenario: {number(request.estimate.planningDays)} working days, assuming {request.estimate.staffCount} allocated people at {company.config.hoursPerDay} hours per day and {request.estimate.dependencyDays} days of dependency delay.{request.estimate.projectedDeliveryDate ? " Projected finish: " + request.estimate.projectedDeliveryDate + "." : " Add a planned start date to calculate a projected finish."} Weekends are excluded; holidays and real calendar conflicts are not checked, so this is not a commitment.</p>}
        <button disabled={busy || !!outcome} className={button + " mt-4"} onClick={async () => { const saved = await action({ action: "freeze" }); if (saved) setStage("commitment"); }}>Approve and freeze commitment baseline</button>
      </>}
    </Section>}
    {stage === "commitment" && baseline && <>
    <Section title="Commitment baseline"><p className="text-sm leading-6">Baseline {request.baselines.length} freezes the reviewed scope and effort estimate. Tracking updates are stored separately so this agreement remains unchanged.</p><div className="mt-4 grid gap-3 md:grid-cols-3">{[["Low", baseline.estimate.low], ["Central", baseline.estimate.hours], ["High", baseline.estimate.high]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[var(--paper)] p-4"><p className="text-xs text-[var(--muted)]">{label} effort</p><p className="mt-1 text-xl font-semibold">{number(value as number)} h</p></div>)}</div><p className="mt-3 text-xs text-[var(--muted)]">Frozen {new Date(baseline.createdAt).toLocaleString()} · source revision {baseline.revision} · {baseline.evaluationSplit} cohort</p><p className="mt-2 text-sm"><strong>Deliverables:</strong> {baseline.review.deliverables}</p><p className="mt-1 text-sm"><strong>Exclusions:</strong> {baseline.review.exclusions || "None recorded"}</p><details className="mt-3 rounded-xl bg-[var(--paper)] p-3"><summary className="cursor-pointer text-xs">Baseline integrity and export</summary><p className="mt-2 text-xs">Approved configuration snapshot: {baseline.config.version}</p><p className="mt-2 break-all font-mono text-[10px]">SHA-256 {baseline.sha256}</p><button className={secondary + " mt-3"} onClick={() => download("frozen-estimate-" + baseline.id + ".json", JSON.stringify(baseline, null, 2))}>Export this baseline</button></details></Section>
    <TaskTrackingPanel company={company} request={request} baseline={baseline} busy={busy} action={action} />
    <DeliverySchedulePanel work={baseline.review.workPackages.map(work => ({ id: work.id, title: work.title, owner: work.owner, hours: baseline.estimate.tasks.find(task => task.category === work.id)?.hours ?? 0 }))} members={company.members.map(member => ({ id: member.accountId, label: member.accountId }))} schedule={request.schedule} canEdit={["admin", "member"].includes(company.role) && !outcome} busy={busy} onSave={schedule => action({ action: "schedule.plan", baselineId: baseline.id, schedule })} onApply={() => action({ action: "schedule.apply", baselineId: baseline.id })} />
    <CommitmentChanges company={company} request={request} busy={busy} action={action} />
    {baseline.revision === request.revision && !outcome && <Section title="Review actual delivery"><p className="mb-4 text-sm leading-6 text-[var(--muted)]">When work finishes, submit actual effort against this frozen baseline. Added-scope effort stays separate and an independent reviewer must approve recorded outcomes.</p><form className="space-y-4" onSubmit={event => { event.preventDefault(); void action({ action: "delivery", baselineId: baseline.id, reviewerId: reviewer, completedAt: new Date(deliveryDate).toISOString(), actualHours: Object.fromEntries(baseline.estimate.tasks.map(task => [task.category, Number(actuals[task.category])])), additionalScopeHours: Number(additional), synthetic, evidenceSource: source, evidenceReference: reference }); }}>
      <div className="grid gap-3 md:grid-cols-2">{baseline.estimate.tasks.map(task => <Field name={task.label + " actual hours"} key={task.category}><input className={input} required type="number" min="0" step=".1" value={actuals[task.category] || ""} onChange={event => setActuals({ ...actuals, [task.category]: event.target.value })} /></Field>)}
        <Field name="Added-scope hours (excluded from learning)"><input className={input} type="number" min="0" step=".1" value={additional} onChange={event => setAdditional(event.target.value)} /></Field><Field name="Delivery completion"><input className={input} type="datetime-local" required value={deliveryDate} onChange={event => setDeliveryDate(event.target.value)} /></Field>
        <Field name="Evidence source"><select className={input} value={source} onChange={event => setSource(event.target.value)}><option value="timesheet">Timesheet</option><option value="client-confirmed">Client confirmed</option><option value="manual-reviewed">Reviewed delivery record</option></select></Field><Field name="Evidence reference"><input className={input} value={reference} required={!synthetic} minLength={3} onChange={event => setReference(event.target.value)} /></Field>
        <Field name="Independent reviewer"><select className={input} required value={reviewer} onChange={event => setReviewer(event.target.value)}><option value="">Select a different reviewer</option>{company.members.filter(member => member.accountId !== accountId && ["admin", "reviewer"].includes(member.role)).map(member => <option value={member.accountId} key={member.accountId}>{member.accountId} · {member.role}</option>)}</select></Field>
      </div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={synthetic} onChange={event => setSynthetic(event.target.checked)} />Fictional demonstration outcome</label><button className={button} disabled={busy}>Submit actuals for independent review</button>
    </form></Section>}
    {outcome && <Section title="Delivery review"><p className="text-sm">Status: {outcome.reviewStatus} · original scope {number(Object.values(outcome.actualHours).reduce((sum, value) => sum + value, 0))} h · added scope {number(outcome.additionalScopeHours)} h</p><p className="mt-2 text-xs">{outcome.synthetic ? "Synthetic demonstration" : "Recorded outcome"} · {outcome.calibrationReason}</p><p className="mt-2 text-xs">Evidence: {outcome.evidenceSource} · {outcome.evidenceReference}</p>
      {outcome.reviewStatus === "pending" && outcome.reviewerId === accountId && <div className="mt-4"><Field name="Review note after reconciling scope and delivery evidence"><textarea className={input} value={note} onChange={event => setNote(event.target.value)} /></Field><div className="mt-3 flex gap-2"><button className={button} disabled={busy || note.trim().length < 3} onClick={() => action({ action: "delivery.review", decision: "approved", note })}>Approve delivery actuals</button><button className={secondary} disabled={busy || note.trim().length < 3} onClick={() => action({ action: "delivery.review", decision: "rejected", note })}>Reject</button></div></div>}
      {outcome.reviewDecisions.map((decision, index) => <p key={index} className="mt-3 text-xs">{decision.decision} by {decision.actorId} · {decision.note}</p>)}
      {outcome.reviewStatus === "rejected" && outcome.submittedBy === accountId && <button className={secondary + " mt-4"} disabled={busy} onClick={() => action({ action: "delivery.revise" })}>Correct actuals and resubmit</button>}
    </Section>}
    {!!request.deliveryHistory?.length && <Section title="Earlier rejected actuals">{request.deliveryHistory.map((previous,index)=><details key={index} className="mb-3 rounded-xl bg-[var(--paper)] p-3"><summary className="cursor-pointer text-xs">Rejected submission {index+1} · excluded from learning</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(previous,null,2)}</pre></details>)}</Section>}
    </>}
  </>;
}

const trackingStatuses: { value: TaskTrackingStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
  { value: "accepted", label: "Accepted" },
];
function TaskTrackingPanel({ company, request, baseline, busy, action }: { company: Company; request: ClientRequest; baseline: NonNullable<ClientRequest["baselines"]>[number]; busy: boolean; action: (body: Record<string, unknown>) => Promise<ActionResult> }) {
  return <Section title="Commitment tracking"><p className="mb-4 max-w-3xl text-sm leading-6 text-[var(--muted)]">Update task progress against the frozen scope. These updates are logged separately and never change the approved baseline. Delivery dates remain planning targets until staffing and dependencies are confirmed.</p><div className="space-y-4">{baseline.review.workPackages.map(work => <TaskTrackingRow key={baseline.id + ":" + work.id} company={company} request={request} baselineId={baseline.id} work={work} estimate={baseline.estimate.tasks.find(task => task.category === work.id)} current={request.tracking?.find(item => item.baselineId === baseline.id && item.workPackageId === work.id)} busy={busy} action={action} />)}</div></Section>;
}
function TaskTrackingRow({ company, request, baselineId, work, estimate, current, busy, action }: { company: Company; request: ClientRequest; baselineId: string; work: WorkPackage; estimate?: EstimateTask; current?: TaskTracking; busy: boolean; action: (body: Record<string, unknown>) => Promise<ActionResult> }) {
  const [status, setStatus] = useState<TaskTrackingStatus>(current?.status || "not_started");
  const [assigneeId, setAssigneeId] = useState(current?.assigneeId || "");
  const [plannedStart, setPlannedStart] = useState(current?.plannedStart || "");
  const [targetDate, setTargetDate] = useState(current?.targetDate || "");
  const [progressNote, setProgressNote] = useState(current?.note || "");
  const [blocker, setBlocker] = useState(current?.blocker || "");
  const [milestones, setMilestones] = useState<NonNullable<TaskTracking["milestones"]>>(current?.milestones ?? []);
  return <form className="rounded-2xl border border-[var(--line)] p-4" onSubmit={event => { event.preventDefault(); void action({ action: "tracking.update", baselineId, workPackageId: work.id, status, assigneeId, plannedStart, targetDate, note: progressNote, blocker, milestones }); }}>
    <fieldset disabled={busy || !!request.deliveryOutcome || !["admin", "member"].includes(company.role)}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{work.title}</h3><p className="mt-1 text-xs capitalize text-[var(--muted)]">{work.owner}-owned task{work.dependencies ? " · depends on " + work.dependencies : ""}</p></div>{estimate ? <span className="rounded-full bg-[var(--paper)] px-3 py-1 text-xs">{number(estimate.low)}–{number(estimate.high)} h planned</span> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">External prerequisite · no company hours</span>}</div>
    {work.acceptance && <p className="mt-3 text-xs leading-5"><strong>Done when:</strong> {work.acceptance}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field name="Progress status"><select className={input} value={status} disabled={!!request.deliveryOutcome} onChange={event => setStatus(event.target.value as TaskTrackingStatus)}>{trackingStatuses.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
      <Field name="Assigned team member"><select className={input} value={assigneeId} disabled={!!request.deliveryOutcome || work.owner !== "company"} onChange={event => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{company.members.map(member => <option key={member.accountId} value={member.accountId}>{member.accountId}</option>)}</select></Field>
      <Field name="Planned start"><input className={input} type="date" value={plannedStart} disabled={!!request.deliveryOutcome} onChange={event => setPlannedStart(event.target.value)} /></Field>
      <Field name="Target date"><input className={input} type="date" value={targetDate} disabled={!!request.deliveryOutcome} onChange={event => setTargetDate(event.target.value)} /></Field>
    </div>
    {status === "blocked" && <Field name="Blocker description"><textarea required minLength={3} maxLength={1000} className={input} value={blocker} disabled={!!request.deliveryOutcome} onChange={event => setBlocker(event.target.value)} /></Field>}
    <div className="mt-4"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">Task milestones</h4><button type="button" className="text-xs underline" disabled={busy || !!request.deliveryOutcome || milestones.length >= 20} onClick={() => setMilestones(current => [...current, { id: crypto.randomUUID(), title: "", dueDate: "", status: "pending" }])}>Add milestone</button></div>{milestones.map(milestone => <div key={milestone.id} className="mt-2 grid gap-2 rounded-xl bg-[var(--paper)] p-3 sm:grid-cols-[1fr_150px_130px_auto]"><Field name="Milestone"><input required maxLength={160} className={input} value={milestone.title} disabled={!!request.deliveryOutcome} onChange={event => setMilestones(current => current.map(item => item.id === milestone.id ? { ...item, title: event.target.value } : item))} /></Field><Field name="Due date"><input type="date" className={input} value={milestone.dueDate} disabled={!!request.deliveryOutcome} onChange={event => setMilestones(current => current.map(item => item.id === milestone.id ? { ...item, dueDate: event.target.value } : item))} /></Field><Field name="Progress"><select className={input} value={milestone.status} disabled={!!request.deliveryOutcome} onChange={event => setMilestones(current => current.map(item => item.id === milestone.id ? { ...item, status: event.target.value as "pending" | "complete" } : item))}><option value="pending">Pending</option><option value="complete">Complete</option></select></Field><button type="button" className="text-xs underline" disabled={!!request.deliveryOutcome} onClick={() => setMilestones(current => current.filter(item => item.id !== milestone.id))}>Remove</button></div>)}</div>
    <div className="mt-3 flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Field name="Progress note"><textarea className={input} rows={2} maxLength={1000} value={progressNote} disabled={!!request.deliveryOutcome} placeholder="Record the latest progress or what is blocked" onChange={event => setProgressNote(event.target.value)} /></Field></div><button disabled={busy || !!request.deliveryOutcome} className={secondary}>Save progress</button></div>
    {current?.updatedAt && <p className="mt-2 text-[11px] text-[var(--muted)]">Updated {new Date(current.updatedAt).toLocaleString()} by {current.updatedBy || "a workspace member"}</p>}
    </fieldset>
  </form>;
}
function AttachmentView({ attachment }: { attachment: Attachment }) {
  return <details className="mt-3 rounded-xl border border-[var(--line)] bg-white p-3"><summary className="cursor-pointer text-xs">{attachment.name} · {attachment.status}{attachment.truncated ? " · truncated" : ""}</summary>{attachment.error && <p className="mt-2 text-xs text-red-800">{attachment.error}</p>}<p className="mt-2 text-xs text-[var(--muted)]">{attachment.locators?.join(" · ")}</p><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-6">{attachment.text}</pre></details>;
}

function KnowledgePanel({ company, busy, action, request }: { company: Company; busy: boolean; action: (body: Record<string, unknown>) => unknown; request: (path: string, body: BodyInit) => unknown }) {
  const [title, setTitle] = useState(""), [url, setURL] = useState(""), [text, setText] = useState("");
  const [query, setQuery] = useState(""), [passages, setPassages] = useState<Passage[]>([]), [searchError, setSearchError] = useState("");
  const admin = company.role === "admin";
  return <div className="grid gap-6 lg:grid-cols-2"><div className="space-y-5">
    <Section title="Approved company knowledge"><p className="text-sm leading-7 text-[var(--muted)]">Approve a specific source version before it can support recommendations. Source URLs, retrieval dates, and content digests remain attached to the findings and frozen estimate.</p>
      <form className="mt-4 flex gap-2" onSubmit={event => { event.preventDefault(); setSearchError(""); void api<{ passages: Passage[] }>(`companies/${company.id}/knowledge?q=${encodeURIComponent(query)}`).then(data => setPassages(data.passages)).catch(error => setSearchError(error.message)); }}><input className={input} aria-label="Search approved company knowledge" placeholder="Search approved sources" value={query} onChange={event => setQuery(event.target.value)} /><button className={secondary}>Search</button></form>
      {searchError && <p role="alert" className="mt-2 text-sm text-red-800">{searchError}</p>}
      {passages.map((item, index) => <blockquote key={index} className="mt-3 rounded-xl bg-[var(--paper)] p-3 text-sm leading-6">“{item.passage}”<cite className="mt-2 block text-xs">{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.title}</a> : item.title} · {new Date(item.retrievedAt).toLocaleDateString()}</cite></blockquote>)}
      {company.knowledge.length === 0 && <p className="mt-4 text-sm">No knowledge sources have been added. Product fit remains unverified until supporting knowledge is approved.</p>}
      {company.knowledge.map(item => <details key={item.id} className="mt-3 rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer text-sm font-medium">{item.title} · {item.status}</summary><p className="mt-2 break-all text-xs">{item.url || "Uploaded or administrator-supplied document"} · retrieved {new Date(item.retrievedAt).toLocaleString()}</p>{item.status === "approved" && item.url && <p className="mt-2 text-xs text-[var(--muted)]">Automatic refresh runs every 30 days. A changed page creates a draft; an administrator must review and approve it. {item.lastRefreshAttemptAt ? "Last attempt: " + new Date(item.lastRefreshAttemptAt).toLocaleString() + "." : "No refresh attempt recorded yet."}</p>}{item.lastRefreshError && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs">Last refresh failed: {item.lastRefreshError}</p>}<pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-6">{item.text}</pre><p className="mt-2 break-all font-mono text-[10px]">SHA-256 {item.sha256}</p>{item.approvedBy && <p className="mt-2 text-xs">Approved by {item.approvedBy}</p>}
        {admin && <div className="mt-3 flex flex-wrap gap-2">{item.status === "draft" && <button className={button} disabled={busy} onClick={() => action({ action: "knowledge.approve", documentId: item.id })}>Approve this source version</button>}{item.status !== "retired" && <button className={secondary} disabled={busy} onClick={() => action({ action: "knowledge.retire", documentId: item.id })}>Retire</button>}{item.status === "approved" && item.url && <button className={secondary} disabled={busy} onClick={() => request("fetch", JSON.stringify({ title: item.title, url: item.url, replacesId: item.id }))}>Retrieve a new draft version</button>}</div>}
      </details>)}
    </Section>
  </div>
  {admin && <div className="space-y-5"><Section title="Add an approved-domain website"><form className="space-y-3" onSubmit={event => { event.preventDefault(); request("fetch", JSON.stringify({ title, url })); }}>
    <Field name="Source title"><input className={input} required value={title} onChange={event => setTitle(event.target.value)} /></Field><Field name="HTTPS source URL"><input className={input} required type="url" value={url} onChange={event => setURL(event.target.value)} /></Field><p className="text-xs leading-5 text-[var(--muted)]">Allowed hosts: {company.config.approvedDomains.join(", ") || "Add approved domains in Settings first."} Each retrieved version starts as a draft for your inspection.</p><button className={button} disabled={busy}>Retrieve draft source</button>
  </form></Section>
  <Section title="Upload an internal knowledge document"><form className="space-y-3" onSubmit={event => { event.preventDefault(); request("upload", new FormData(event.currentTarget)); }}><Field name="Source title"><input name="title" className={input} /></Field><input name="file" aria-label="Knowledge document" type="file" accept={formats} required className="block max-w-full text-sm" /><button className={button} disabled={busy}>Extract a draft source</button></form></Section>
  <Section title="Add reviewed internal text"><form className="space-y-3" onSubmit={event => { event.preventDefault(); action({ action: "knowledge.add", document: { title, text, url: "" } }); }}><Field name="Source title"><input required className={input} value={title} onChange={event => setTitle(event.target.value)} /></Field><Field name="Source text"><textarea required minLength={30} maxLength={100000} rows={8} className={input} value={text} onChange={event => setText(event.target.value)} /></Field><button className={button} disabled={busy}>Save draft knowledge</button></form></Section></div>}
  </div>;
}

function CompanySettings({ company, accountId, busy, save, deleted }: { company: Company; accountId: string; busy: boolean; save: (configuration: Configuration) => unknown; action: (body: Record<string, unknown>) => unknown; deleted: () => void }) {
  const [draft, setDraft] = useState<Configuration>(() => structuredClone(company.config));
  const [deleteError, setDeleteError] = useState("");
  const admin = company.role === "admin";
  function patch(patch: Partial<Configuration>) { setDraft(current => ({ ...current, ...patch })); }
  const list = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
  return <div className="space-y-5">
    <Section title="Company configuration"><p className="text-sm leading-7 text-[var(--muted)]">Every save creates a new configuration version. Existing baselines preserve their configuration, sources, and original calculations.</p><p className="mt-2 text-xs">Your account ID for team assignments: <span className="font-mono">{accountId}</span></p>
      {admin && <div className="mt-4 flex flex-wrap gap-2"><button className={secondary} onClick={() => patch({ ...anduinReference })}>Load Anduin reference example</button><button className={secondary} onClick={() => download("company-configuration.json", JSON.stringify(draft, null, 2))}>Export configuration</button><a className={secondary} href={`/api/workflow/companies/${company.id}/schema`} target="_blank" rel="noreferrer">Intake JSON Schema</a></div>}
      <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-6">Reference task hours are illustrative planning priors, not Anduin delivery measurements. Configure values for your own process and approve the knowledge separately. No profile supplies presumed team capabilities.</p>
    </Section>
    <fieldset disabled={!admin || busy} className="space-y-5">
      <Section title="Required intake information"><div className="space-y-4">{draft.fields.map((field, index) => <div key={index} className="rounded-xl bg-[var(--paper)] p-4"><div className="grid gap-3 md:grid-cols-3">
        <Field name="Field key"><input className={input} value={field.key} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, key: event.target.value } : item) })} /></Field><Field name="Label"><input className={input} value={field.label} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /></Field>
        <Field name="Value type"><select className={input} value={field.type} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, type: event.target.value as typeof field.type } : item) })}>{["string", "number", "boolean", "enum"].map(value => <option key={value}>{value}</option>)}</select></Field>
        <Field name="Required for request types (comma separated; blank = all)"><input className={input} value={field.requestTypes?.join(", ") || ""} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, requestTypes: list(event.target.value) } : item) })} /></Field>
        <Field name="Allowed values for an enum (comma separated)"><input className={input} value={field.options?.join(", ") || ""} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, options: list(event.target.value) } : item) })} /></Field>
        <Field name="Clarification priority"><select className={input} value={field.priority||"medium"} onChange={event=>patch({fields:draft.fields.map((item,i)=>i===index?{...item,priority:event.target.value as "high"|"medium"|"low"}:item)})}>{["high","medium","low"].map(priority=><option key={priority}>{priority}</option>)}</select></Field>
        <Field name="Question to ask when this required information is missing"><input className={input} value={field.question||""} onChange={event=>patch({fields:draft.fields.map((item,i)=>i===index?{...item,question:event.target.value}:item)})} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={field.required} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, required: event.target.checked } : item) })} />Required</label>
        <Field name="Condition: other field"><select className={input} value={Object.keys(field.requiredWhen || {})[0] || ""} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, requiredWhen: event.target.value ? { [event.target.value]: Object.values(field.requiredWhen || {})[0] || "" } : {} } : item) })}><option value="">No additional condition</option>{draft.fields.filter(other => other.key !== field.key).map(other => <option key={other.key} value={other.key}>{other.label}</option>)}</select></Field>
        <Field name="Condition: required when that field equals"><input className={input} disabled={!Object.keys(field.requiredWhen || {}).length} value={Object.values(field.requiredWhen || {})[0] || ""} onChange={event => patch({ fields: draft.fields.map((item, i) => i === index ? { ...item, requiredWhen: { [Object.keys(field.requiredWhen || {})[0]]: event.target.value } } : item) })} /></Field>
      </div><button className="mt-3 text-xs underline" onClick={() => patch({ fields: draft.fields.filter((_, i) => i !== index) })}>Remove field</button></div>)}</div><button className={secondary + " mt-3"} onClick={() => patch({ fields: [...draft.fields, { key: "field" + (draft.fields.length + 1), label: "New field", type: "string", required: false, requestTypes: [], options: [], requiredWhen: {} }] })}>Add intake field</button></Section>
      <Section title="Products and services"><div className="space-y-3">{draft.products.map((product, index) => <div key={index} className="grid gap-3 rounded-xl bg-[var(--paper)] p-3 md:grid-cols-3"><Field name="Product ID"><input className={input} value={product.id} onChange={event => patch({ products: draft.products.map((item, i) => i === index ? { ...item, id: event.target.value } : item) })} /></Field><Field name="Name"><input className={input} value={product.name} onChange={event => patch({ products: draft.products.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></Field><Field name="Description"><textarea className={input} value={product.description} onChange={event => patch({ products: draft.products.map((item, i) => i === index ? { ...item, description: event.target.value } : item) })} /></Field><button className="text-left text-xs underline" onClick={() => patch({ products: draft.products.filter((_, i) => i !== index) })}>Remove product</button></div>)}</div><button className={secondary + " mt-3"} onClick={() => patch({ products: [...draft.products, { id: "product" + (draft.products.length + 1), name: "New product", description: "" }] })}>Add product or service</button></Section>
      <Section title="Task templates and effort priors"><p className="mb-3 text-xs leading-6 text-[var(--muted)]">Base hours apply to one reviewed unit. Lower and upper factors create a planning range around adjusted task hours. Historical adjustments remain visible and use only eligible training deliveries.</p>
        <div className="space-y-4">{draft.tasks.map((task, index) => <div key={index} className="grid gap-3 rounded-xl bg-[var(--paper)] p-4 md:grid-cols-3"><Field name="Task ID"><input className={input} value={task.id} onChange={event => patch({ tasks: draft.tasks.map((item, i) => i === index ? { ...item, id: event.target.value } : item) })} /></Field><Field name="Label"><input className={input} value={task.label} onChange={event => patch({ tasks: draft.tasks.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /></Field><Field name="Applicable request types (comma separated; blank = all)"><input className={input} value={task.requestTypes?.join(", ") || ""} onChange={event => patch({ tasks: draft.tasks.map((item, i) => i === index ? { ...item, requestTypes: list(event.target.value) } : item) })} /></Field>
          {(["baseHours", "lowFactor", "highFactor"] as const).map(key => <Field key={key} name={{ baseHours: "Base hours per unit", lowFactor: "Lower factor (0–1)", highFactor: "Upper factor (1–10)" }[key]}><input className={input} type="number" min=".01" step=".1" value={task[key]} onChange={event => patch({ tasks: draft.tasks.map((item, i) => i === index ? { ...item, [key]: Number(event.target.value) } : item) })} /></Field>)}<button className="text-left text-xs underline" onClick={() => patch({ tasks: draft.tasks.filter((_, i) => i !== index) })}>Remove task</button>
        </div>)}</div><button className={secondary + " mt-3"} onClick={() => patch({ tasks: [...draft.tasks, { id: "task" + (draft.tasks.length + 1), label: "New task", requestTypes: [], baseHours: 4, lowFactor: .75, highFactor: 1.5 }] })}>Add task template</button>
      </Section>
      <Section title="Verified capabilities, sources, and retention"><div className="grid gap-4 md:grid-cols-2"><Field name="Verified team capabilities (one per line)"><textarea className={input} rows={5} value={draft.capabilities.join("\n")} onChange={event => patch({ capabilities: event.target.value.split("\n").filter(Boolean) })} /></Field><Field name="Approved source domains (exact host names, one per line)"><textarea className={input} rows={5} value={draft.approvedDomains.join("\n")} onChange={event => patch({ approvedDomains: event.target.value.split("\n").map(value => value.trim().toLowerCase()).filter(Boolean) })} /></Field><Field name="Request data retention (days)"><input className={input} type="number" min="1" max="3650" value={draft.retentionDays} onChange={event => patch({ retentionDays: Number(event.target.value) })} /></Field><Field name="Task sizing guideline (central hours)"><input className={input} type="number" min="1" max="10000" value={draft.taskSizeGuidelineHours || 16} onChange={event => patch({ taskSizeGuidelineHours: Number(event.target.value) })} /></Field><Field name="Planning hours per person per working day"><input className={input} type="number" min=".1" max="24" value={draft.hoursPerDay} onChange={event => patch({ hoursPerDay: Number(event.target.value) })} /></Field></div><p className="mt-3 rounded-xl bg-[var(--paper)] p-3 text-xs leading-6">Requests, source text, estimates, and delivery records are purged {draft.retentionDays} days after the request’s last update. Original attachment bytes are purged with the request. Expired data is removed at service startup and every six hours; deleting a request removes its attachment bytes immediately. Configure 1–3650 days to match your company policy.</p></Section>
      <button className={button} onClick={() => save(draft)}>Save a new configuration version</button>
    </fieldset>
    <Section title="Configuration history"><div className="flex flex-wrap gap-2">{company.configHistory.map(version => <button key={version.version} className={secondary} disabled={!admin} onClick={() => setDraft(structuredClone(version))}>Use v{version.version} as draft</button>)}</div><p className="mt-3 text-xs text-[var(--muted)]">Restoring a prior configuration creates a new version when saved. Frozen baselines retain their original settings.</p></Section>
    {admin && <Section title="Delete company data"><p className="text-sm">This removes this workspace, membership grants, company knowledge, connectors, requests, and delivery evidence.</p><button className={secondary + " mt-3"} onClick={() => { if (window.prompt("Type the company name to delete all its data:") !== company.name) return; void api("companies/" + company.id, { method: "DELETE" }).then(deleted).catch(error => setDeleteError(error.message)); }}>Delete company workspace</button>{deleteError && <p role="alert" className="mt-2 text-sm text-red-800">{deleteError}</p>}</Section>}
  </div>;
}

function MembersPanel({ company, busy, action }: { company: Company; busy: boolean; action: (body: Record<string, unknown>) => unknown }) {
  const [newMember, setNewMember] = useState("");
  const [newRole, setNewRole] = useState("member");
  const admin = company.role === "admin";
  return <Section title="Members and roles"><p className="mb-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">Access is granted to registered accounts explicitly. Matching email domains do not grant company access.</p><div className="space-y-2">{company.members.map(member => <div key={member.accountId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 text-sm"><span className="min-w-0 break-all font-mono text-xs">{member.accountId}</span>{admin ? <select aria-label={"Role for " + member.accountId} className="rounded-lg border border-[var(--line)] bg-white p-2" value={member.role} onChange={event => action({ action: "member", accountId: member.accountId, role: event.target.value })}>{["member", "reviewer", "admin"].map(role => <option key={role}>{role}</option>)}</select> : <span className="rounded-full bg-[var(--paper)] px-3 py-1 text-xs capitalize">{member.role}</span>}{admin && <button className="text-xs text-red-800 underline" onClick={() => { if (window.confirm("Remove this account's company access?")) action({ action: "removeMember", accountId: member.accountId }); }}>Remove access</button>}</div>)}</div>
    {admin && <form className="mt-5 flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-5" onSubmit={event => { event.preventDefault(); action({ action: "member", accountId: newMember, role: newRole }); setNewMember(""); }}><Field name="Registered account UUID"><input className={input + " min-w-72"} required placeholder="Account UUID" value={newMember} onChange={event => setNewMember(event.target.value)} /></Field><Field name="Role"><select className={input} value={newRole} onChange={event => setNewRole(event.target.value)}>{["member", "reviewer", "admin"].map(role => <option key={role}>{role}</option>)}</select></Field><button disabled={busy} className={button}>Grant access</button></form>}
  </Section>;
}

function Connectors({ company, busy, action, request }: { company: Company; busy: boolean; action: (body: Record<string, unknown>) => Promise<ActionResult>; request: (path: string) => Promise<Record<string, unknown> | undefined> }) {
  const [clientId, setClientId] = useState(""), [clientSecret, setClientSecret] = useState(""), [query, setQuery] = useState(company.gmail.query || "in:inbox");
  const [webhook, setWebhook] = useState<{ secret: string; endpoint: string } | null>(null);
  const [token, setToken] = useState("");
  const origin = useSyncExternalStore(() => () => undefined, () => window.location.origin, () => "");
  const admin = company.role === "admin";
  if (!admin) return <Section title="Company connectors"><p className="text-sm">A company administrator manages inbox connections, inbound form credentials, and knowledge access tokens.</p></Section>;
  return <div className="grid gap-5 lg:grid-cols-2"><Section title="Gmail request intake">
    <p className="text-sm leading-7 text-[var(--muted)]">Connect the inbox that receives client requests. Matching emails and attachments are imported automatically, grouped by thread, and sent for AI analysis. No manual Sync or Analyze action is required.</p>
    <p className="mt-3 rounded-xl bg-[var(--paper)] p-3 text-xs leading-6">{company.gmail.connected ? "Automatic intake is enabled for this mailbox." : "Automatic intake starts after you authorize Gmail below."} The worker checks about every five minutes by default while services are running. You can close this page. Imported requests wait for human scope review before estimation.</p>
    <p className="mt-3 text-xs">Status: {company.gmail.connected ? "Connected" : company.gmail.linkedBy ? "OAuth client saved; mailbox authorization pending" : "Not configured"}{company.gmail.lastSyncedAt ? " · last complete sync " + new Date(company.gmail.lastSyncedAt).toLocaleString() : ""}</p>
    {company.gmail.lastError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs">{company.gmail.lastError}</p>}
    <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void action({ action: "gmail.configure", secrets: { clientId, clientSecret }, query }).then(result => { if (result) { setClientSecret(""); setClientId(""); } }); }}>
      <Field name="Google OAuth client ID"><input className={input} required autoComplete="off" value={clientId} onChange={event => setClientId(event.target.value)} /></Field><Field name="Google OAuth client secret"><input className={input} required type="password" autoComplete="new-password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} /></Field><Field name="Mailbox search query"><input className={input} required maxLength={500} value={query} onChange={event => setQuery(event.target.value)} /></Field>
      <p className="text-xs leading-6 text-[var(--muted)]">Only emails matching this query are imported, including existing matches on first connection. Use a client sender, subject, or dedicated Gmail label. For the mock email, use subject:EST-MOCK-20261019-01.</p>
      <p className="text-xs leading-6 text-[var(--muted)]">Register this redirect URI in your Google Cloud OAuth client: <span className="break-all font-mono">{origin}/api/workflow/gmail/callback</span>. Credentials and refresh tokens are encrypted; they are not returned with workspace data. Saving a new client clears the previous mailbox authorization.</p><button className={secondary} disabled={busy}>Save OAuth client</button>
    </form><div className="mt-4 flex flex-wrap gap-2">{company.gmail.linkedBy && <a className={button} href={`/api/workflow/companies/${company.id}/gmail/connect`}>Authorize Gmail</a>}{company.gmail.connected && <><button className={secondary} disabled={busy} onClick={() => request("gmail/sync")}>Sync now</button><button className={secondary} disabled={busy} onClick={() => { if (window.confirm("Disconnect this mailbox and revoke its refresh token?")) request("gmail/disconnect"); }}>Disconnect Gmail</button></>}</div>
  </Section>
  <Section title="Demo forms, CRM, and generic inbound webhooks"><p className="text-sm leading-7 text-[var(--muted)]">Connect your form provider or CRM to this company’s signed intake endpoint. Use a unique submission ID so retries cannot create duplicate requests. Existing form access must be authorized by its owner.</p>
    <button className={button + " mt-4"} disabled={busy} onClick={() => { void action({ action: "webhook.rotate" }).then(async result => { if (result) setWebhook(await api(`companies/${company.id}/webhook-secret`)); }); }}>Generate or rotate form secret</button>
    {webhook && <div className="mt-4 space-y-3"><Field name="Inbound URL"><input className={input} readOnly value={webhook.endpoint} /></Field><Field name="Shared signing secret"><input className={input} type="password" readOnly value={webhook.secret} /><button className="mt-2 text-xs underline" onClick={() => navigator.clipboard.writeText(webhook.secret)}>Copy secret</button></Field><p className="text-xs leading-6">Send JSON containing submissionId, title, text, and optional base64 attachments. Headers: X-Workflow-Timestamp (UTC ISO timestamp), X-Workflow-Signature (hex HMAC-SHA256 of timestamp + &quot;.&quot; + exact JSON bytes). Signatures expire after five minutes.</p></div>}
  </Section>
  <Section title="Common knowledge protocol"><p className="text-sm leading-7 text-[var(--muted)]">Company knowledge is available through MCP Streamable HTTP and a versioned REST search endpoint. Both return only administrator-approved source versions with citations. This lets another company connect the same workflow to its own approved documents.</p><Field name="MCP endpoint"><input className={input} readOnly value={`${origin}/api/workflow/companies/${company.id}/mcp`} /></Field>
    <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { void action({ action: "knowledge.token.rotate" }).then(result => { if (result) setToken(result.objectId); }); }}>Generate read-only knowledge token</button><button className={secondary} disabled={busy} onClick={() => { void action({ action: "knowledge.token.revoke" }); setToken(""); }}>Revoke token</button></div>
    {token && <div className="mt-3"><Field name="One-time token (use an Authorization: Bearer header)"><input className={input} type="password" readOnly value={token} /></Field><button className="mt-2 text-xs underline" onClick={() => navigator.clipboard.writeText(token)}>Copy token</button></div>}
    <p className="mt-3 text-xs leading-6 text-[var(--muted)]">Available read tools: knowledge_search and knowledge_fetch. Customer requests, mailbox tokens, and delivery records are not exposed by these tools.</p>
  </Section></div>;
}

type EvaluationReport = { status: string; holdout: Record<string, { count: number; baseAbsoluteErrorSum: number; adjustedAbsoluteErrorSum: number; signedBiasSum: number; covered: number; domains: Record<string, number>; sampleLimit: string }>; excluded: Record<string, number>; limitations: string[] };
function Evaluation({ company }: { company: Company }) {
  const [report, setReport] = useState<EvaluationReport | null>(null), [error, setError] = useState("");
  useEffect(() => { void api<EvaluationReport>(`companies/${company.id}/evaluation`).then(setReport).catch(error => setError(error.message)); }, [company.id, company.version]);
  return <Section title="Frozen delivery holdout evaluation"><p className="text-sm leading-7 text-[var(--muted)]">The split is assigned when the baseline is frozen, before actuals are submitted. Only approved holdout outcomes appear below; training deliveries inform future adjustments. Synthetic results never count as recorded evidence.</p>{error && <p role="alert">{error}</p>}
    {report && <><p className="mt-4 text-sm font-medium">{report.status === "no_eligible_holdout" ? "No eligible holdout outcomes are available." : "Descriptive cohort measurements"}</p>
      {Object.entries(report.holdout).map(([name, group]) => <div key={name} className="mt-4 rounded-xl bg-[var(--paper)] p-4"><h3 className="font-semibold">{name === "synthetic" ? "Synthetic demonstration" : "Recorded deliveries"}</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">{[["Samples", group.count], ["Base MAE", number(group.baseAbsoluteErrorSum / group.count) + " h"], ["Adjusted MAE", number(group.adjustedAbsoluteErrorSum / group.count) + " h"], ["Signed bias", number(group.signedBiasSum / group.count) + " h"], ["Range coverage", number(100 * group.covered / group.count) + "%"]].map(([key, value]) => <div key={key}><dt className="text-xs text-[var(--muted)]">{key}</dt><dd className="mt-1">{value}</dd></div>)}</dl><p className="mt-3 text-xs">Domains: {Object.entries(group.domains).map(([key, value]) => key + " (" + value + ")").join(", ")}</p><p className="mt-2 text-xs">{group.sampleLimit}</p></div>)}
      <p className="mt-4 text-xs leading-6">Excluded: {Object.entries(report.excluded).map(([reason, count]) => reason.replaceAll("_", " ") + ": " + count).join(" · ") || "None"}</p><ul className="mt-3 list-inside list-disc space-y-1 text-xs">{report.limitations.map(text => <li key={text}>{text}</li>)}</ul>
      <div className="mt-4 flex flex-wrap gap-2"><a className={button} href={`/api/workflow/companies/${company.id}/export`}>Export delivery JSONL</a><button className={secondary} onClick={() => download("holdout-report.json", JSON.stringify(report, null, 2))}>Download report</button></div>
    </>}
  </Section>;
}
