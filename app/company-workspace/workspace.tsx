"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Check, CheckCircle2, ClipboardList, FileText, History, Layers3, Loader2, Plug, Plus, Settings2, ShieldCheck, Sparkles, Users, WandSparkles, X } from "lucide-react";
import type { ClientRequest, Company, CompanyConfig, ScopeReview, ScopeWorkPackage, WorkspaceResponse } from "../../lib/client-workflow-types";
import { extractClientFile, type ExtractedUpload } from "../../lib/browser-document-extraction";

import { AuditPanel, ConnectorsPanel, DeliveryPanel, EvaluationPanel, MembersPanel } from "./governance";
import { button, secondary, input, label, card, Section } from "./ui";

type Panel = "requests" | "knowledge" | "settings" | "evaluation" | "members" | "connectors" | "audit";
const panels = [
  { id: "requests", title: "Requests", icon: ClipboardList },
  { id: "knowledge", title: "Knowledge", icon: FileText },
  { id: "settings", title: "Settings", icon: Settings2 },
  { id: "members", title: "Members", icon: Users },
  { id: "connectors", title: "Connectors", icon: Plug },
  { id: "evaluation", title: "Evaluation", icon: ShieldCheck },
  { id: "audit", title: "Audit", icon: History },
] as const;
const types = ["demo", "setup", "migration", "integration", "customization", "support"] as const;
const typeLabel: Record<string, string> = { demo: "Demo inquiry", setup: "Product setup", migration: "Migration", integration: "Integration", customization: "Customization", support: "Support" };
type UploadItem = { file: File; result?: ExtractedUpload; error?: string };

function Field({ name, children }: { name: string; children: ReactNode }) { return <label className={label}>{name}{children}</label>; }

async function api(body?: Record<string, unknown> | FormData, companyId?: string): Promise<WorkspaceResponse> {
  const url = companyId ? `/api/company-workspace?company=${encodeURIComponent(companyId)}` : "/api/company-workspace";
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(url, body ? { method: "POST", headers: isForm ? undefined : { "content-type": "application/json" }, body: isForm ? body : JSON.stringify(body), cache: "no-store" } : { cache: "no-store" });
  const data = await response.json() as WorkspaceResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "The workspace request failed.");
  return data;
}

function Progress({ request }: { request: ClientRequest }) {
  const steps = ["Receive", "Analyze", "Review scope", "Estimate", "Freeze"];
  const current = request.status === "analysis_failed" ? 1 : request.status === "needs_review" || request.status === "analyzing" || request.status === "received" ? 2 : request.status === "scope_confirmed" ? 3 : request.status === "estimated" ? 4 : 5;
  return <ol aria-label="Request workflow progress" className="grid grid-cols-5 gap-2">{steps.map((step, index) => <li key={step} className="min-w-0"><div className={`mb-2 h-1.5 rounded-full ${index < current ? "bg-[var(--ink)]" : "bg-[var(--line)]"}`} /><span className={`text-[10px] uppercase tracking-wide ${index < current ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{step}</span></li>)}</ol>;
}

export default function CompanyWorkspace({ userName, guest = false }: { userName: string; guest?: boolean }) {
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [panel, setPanel] = useState<Panel>("requests");
  const [companyId, setCompanyId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [cohort, setCohort] = useState<"synthetic" | "recorded">("synthetic");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [processingUploads, setProcessingUploads] = useState(false);
  const company = data?.company ?? null;
  const canEstimate = !!company && ["admin", "estimator"].includes(company.role);
  const request = company?.requests.find(item => item.id === requestId) ?? null;
  const [review, setReview] = useState<ScopeReview | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (id?: string) => {
    if (guest) return;
    setBusy("load"); setError("");
    try {
      const next = await api(undefined, id || companyId || undefined);
      setData(next);
      const nextCompany = next.company;
      setCompanyId(nextCompany?.id ?? "");
      setRequestId(current => nextCompany?.requests.some(item => item.id === current) ? current : nextCompany?.requests[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open company workspace."); }
    finally { setBusy(""); }
  }, [companyId, guest]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!request) { setReview(null); return; }
      setReview(structuredClone(request.review)); setEditing(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [request]);

  async function run(name: string, work: () => Promise<WorkspaceResponse>) {
    setBusy(name); setError(""); setNotice("");
    try {
      const next = await work();
      setData(next);
      const nextCompany = next.company;
      if (nextCompany) {
        setCompanyId(nextCompany.id);
        if (requestId && nextCompany.requests.some(item => item.id === requestId)) setRequestId(requestId);
        else if (nextCompany.requests[0]) setRequestId(nextCompany.requests[0].id);
      }
      return next;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workspace request failed."); return undefined; }
    finally { setBusy(""); }
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    const next = await run("company", () => api({ action: "createCompany", name: companyName }));
    if (next?.company) { setCompanyName(""); setCreatingCompany(false); setPanel("requests"); setNotice("Company workspace created. Add your request templates and approved knowledge when ready."); }
  }
  async function createRequest(event: FormEvent) {
    event.preventDefault();
    if (!company) return;
    if (processingUploads || uploads.some(item => item.error || !item.result)) return;
    const body: Record<string, unknown> = { action: "createRequest", companyId: company.id, title, text, cohort, attachments: uploads.map(item => item.result) };
    const next = await run("receive", async () => {
      if (!uploads.length) return api(body);
      const form = new FormData();
      form.append("payload", JSON.stringify(body));
      for (const item of uploads) form.append("files", item.file, item.file.name);
      return api(form);
    });
    if (next?.company) {
      const created = next.company.requests[0];
      if (created) setRequestId(created.id);
      setTitle(""); setText(""); setUploads([]); setCreatingRequest(false);
      setNotice(created?.analysisError ? "Request saved. AI analysis did not complete; retry it from the request." : "Request analyzed. Review the evidence and scope before estimating.");
    }
  }

  async function action(body: Record<string, unknown>, success: string) {
    if (!company) return;
    const next = await run(String(body.action), () => api({ ...body, companyId: company.id }));
    if (next) setNotice(success);
    return next;
  }

  async function chooseFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length + uploads.length > 10) { setError("Choose no more than 10 request files."); return; }
    setError(""); setProcessingUploads(true);
    const extracted = await Promise.all(selected.map(async file => {
      try { return { file, result: await extractClientFile(file) } satisfies UploadItem; }
      catch (cause) { return { file, error: cause instanceof Error ? cause.message : "Could not read this file." } satisfies UploadItem; }
    }));
    setUploads(current => [...current, ...extracted]);
    setProcessingUploads(false);
  }

  const steps = request?.analysis?.run.steps ?? [];
  const unsavedScope = !!request && !!review && JSON.stringify(review) !== JSON.stringify(request.review);

  if (guest) return <main className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-5 py-12 font-sans sm:px-8"><section className={card + " w-full text-center !p-8 sm:!p-12"}><Sparkles className="mx-auto mb-4" /><p className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">Company request workflow</p><h1 className="mt-2 text-3xl font-medium tracking-tight">Sign in to open your workspace</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--muted)]">Requests, evidence and frozen estimates are available only to your signed-in workspace.</p><a className={button + " mt-6"} href="/signin-with-chatgpt?return_to=%2Fcompany-workspace">Sign in with ChatGPT</a><p className="mt-4"><Link className="text-sm underline" href="/">Back to The Estimator</Link></p></section></main>;

  return <main id="company-main" className="mx-auto flex min-h-dvh w-full max-w-[1280px] flex-col px-5 py-6 font-sans sm:px-8 lg:px-10">
    <a className="sr-only focus:not-sr-only focus:mb-4 focus:rounded-full focus:bg-estimator-ink focus:px-4 focus:py-3 focus:text-white" href="#company-content">Skip to workspace content</a>
    <header className="mb-8 flex flex-wrap items-center justify-between gap-5 border-b border-estimator-line pb-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" aria-label="Back to overview" className="grid size-11 shrink-0 place-items-center rounded-full border border-estimator-line bg-white transition hover:bg-estimator-paper"><ArrowLeft size={17} /></Link>
        <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[.18em] text-estimator-muted">The Estimator</p><h1 className="mt-1 text-xl font-medium leading-tight tracking-tight sm:text-2xl">Company workspace</h1></div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {data?.companies.length ? <select aria-label="Company workspace" className="min-h-11 w-full min-w-0 rounded-xl border border-estimator-line bg-white px-3 py-2 text-sm sm:w-60" value={companyId} onChange={event => { setRequestId(""); setCompanyId(event.target.value); void load(event.target.value); }}><option value="">Choose a company</option>{data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
        <span className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs ${data?.aiReady ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}><span className={`size-1.5 rounded-full ${data?.aiReady ? "bg-green-600" : "bg-amber-500"}`} />{!data ? "Loading…" : data.aiReady ? "AI ready" : "AI setup required"}</span>
        <button className={secondary} onClick={() => setCreatingCompany(value => !value)}><Plus size={15} />{creatingCompany ? "Cancel setup" : "New company"}</button>
      </div>
    </header>
    <div id="company-content" tabIndex={-1} className={`min-w-0 flex-1 ${!company ? "flex flex-col" : ""}`}>
    {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</div>}
    {notice && <div role="status" className="mb-5 rounded-xl bg-green-50 p-4 text-sm text-green-900">{notice}</div>}
    {creatingCompany && <div className="grid flex-1 place-items-center py-8"><form onSubmit={createCompany} className={card + " w-full max-w-xl"}><span className="mb-5 grid size-12 place-items-center rounded-2xl bg-estimator-signal text-estimator-signal-ink"><Layers3 size={23} /></span><p className="text-[10px] uppercase tracking-[.18em] text-estimator-muted">A home for your requests</p><h2 className="mt-2 text-2xl font-medium tracking-tight">Create a company workspace</h2><p className="mb-6 mt-3 text-sm leading-6 text-estimator-muted">Start with generic request fields and planning templates. Add your products, approved knowledge and team when you’re ready.</p><Field name="Company name"><input className={input} placeholder="e.g. Acme Consulting" value={companyName} minLength={2} maxLength={120} required onChange={event => setCompanyName(event.target.value)} /></Field><div className="mt-6 flex flex-wrap gap-2"><button className={button} disabled={!!busy}>Create workspace<ArrowLeft className="rotate-180" size={15}/></button><button type="button" className={secondary} onClick={() => setCreatingCompany(false)}>Cancel</button></div></form></div>}
    {data && !company && !creatingCompany && <div className="grid flex-1 place-items-center py-12"><section className={card + " w-full max-w-2xl text-center !p-8 sm:!p-12"}><span className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-estimator-signal text-estimator-signal-ink"><Layers3 size={27} /></span><p className="text-[10px] font-medium uppercase tracking-[.2em] text-estimator-muted">Your private workspace</p><h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">Good estimates start with context.</h2><p className="mx-auto mt-4 max-w-md text-sm leading-7 text-estimator-muted">Bring your company’s knowledge, request templates and delivery experience together. Then turn each client brief into a scope you can review.</p><button className={button + " mt-7"} onClick={() => setCreatingCompany(true)}><Plus size={16} />Create company workspace</button><p className="mt-4 text-xs text-estimator-muted">Private to your team. Built around your business.</p></section></div>}
    {!data && !error && <div className="grid flex-1 place-items-center py-20"><p role="status" className="flex items-center gap-3 text-sm text-estimator-muted"><Loader2 size={18} className="animate-spin"/>Opening your company workspace…</p></div>}

    {company && !creatingCompany && <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[.18em] text-estimator-muted">{company.role} · configuration v{company.config.version}</p><h2 className="mt-2 break-words text-2xl font-medium tracking-tight sm:text-3xl">{company.name}</h2><p className="mt-2 text-xs text-estimator-muted">Signed in as {userName}</p></div></div>
      <nav aria-label="Company sections" className="mb-7 grid max-w-full grid-cols-4 gap-1 border-b border-estimator-line sm:flex sm:flex-wrap">{panels.map(({ id, title, icon: Icon }) => <button key={id} aria-current={panel === id ? "page" : undefined} className={`inline-flex min-h-16 min-w-0 flex-col items-center justify-center gap-2 border-b-2 px-1 py-3 text-[11px] font-medium transition sm:min-h-12 sm:flex-row sm:px-4 sm:text-xs ${panel === id ? "border-estimator-ink text-estimator-ink" : "border-transparent text-estimator-muted hover:border-estimator-line hover:text-estimator-ink"}`} onClick={() => { setPanel(id); setNotice(""); setError(""); }}><Icon size={15} />{title}</button>)}</nav>
      {busy && <p className="mb-4 flex items-center gap-2 text-sm text-[var(--muted)]" role="status"><Loader2 size={15} className="animate-spin" />{busy === "receive" ? "Analyzing request with AI…" : busy === "analyze" ? "Retrying AI analysis…" : "Saving changes…"}</p>}

      {panel === "requests" && <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="Request list" className="min-w-0 space-y-3 lg:sticky lg:top-6">
          <button disabled={!canEstimate} className={button + " w-full"} onClick={() => { setCreatingRequest(true); setRequestId(""); }}><Plus size={16}/>Receive a request</button>
          <p className="px-1 text-xs leading-5 text-estimator-muted">Start with a message and its documents, or receive a signed form submission through Connectors.</p>
          <div className="max-h-64 space-y-2 overflow-y-auto p-1 lg:max-h-[60vh]">{company.requests.map(item => <button key={item.id} aria-pressed={requestId === item.id} className={`w-full rounded-xl border p-4 text-left transition hover:border-neutral-400 ${requestId === item.id ? "border-neutral-800 bg-white shadow-sm" : "border-estimator-line bg-white/60"}`} onClick={() => { setCreatingRequest(false); setRequestId(item.id); }}><strong className="block break-words text-sm font-medium leading-6">{item.title}</strong><span className="mt-2 inline-flex rounded-full bg-estimator-paper px-2 py-1 text-[10px] capitalize text-estimator-muted">{item.status.replaceAll("_", " ")}</span></button>)}</div>
          {!company.requests.length && <p className={card + " text-sm text-[var(--muted)]"}>No requests yet. Add a client brief to begin.</p>}
        </aside>
        <div className="min-w-0 space-y-5">
          {creatingRequest && <Section title="Receive request" description="Paste a client message or add its documents. The server analyzes source text and approved company knowledge; a person reviews all findings before estimating."><form className="space-y-4" onSubmit={createRequest}><Field name="Request title"><input className={input} value={title} required minLength={3} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="e.g. Investor onboarding and data migration" /></Field><Field name="Evidence cohort"><select className={input} value={cohort} onChange={event => setCohort(event.target.value as "synthetic" | "recorded")}><option value="synthetic">Synthetic / test request</option><option value="recorded">Recorded client request</option></select><span className="mt-1 block">This classification is frozen before actuals and cannot be changed afterward.</span></Field><Field name="Client request"><textarea className={input} rows={8} value={text} maxLength={20000} onChange={event => setText(event.target.value)} placeholder="Paste the request email, form submission, or project brief…" /></Field><Field name="Add documents · PDF, Word, Excel, CSV, text, JSON, or email"><input className={input} type="file" multiple accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json,.eml" disabled={processingUploads || !!busy} onChange={event => { void chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} /></Field>{processingUploads && <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 size={15} className="animate-spin" />Reading file text and sheet or page references…</p>}{uploads.length > 0 && <ul className="space-y-2">{uploads.map((item,index)=><li key={`${item.file.name}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--line)] p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{item.file.name} <span className="font-normal text-[var(--muted)]">({(item.file.size/1024).toFixed(0)} KB)</span></p>{item.error ? <p className="mt-1 text-xs text-red-800">{item.error}</p> : item.result && <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.result.status.replaceAll("_", " ")} · {item.result.text.length.toLocaleString()} characters · {item.result.locators.length} references{item.result.truncated ? " · text shortened to 40,000 characters" : ""}{item.result.message ? ` · ${item.result.message}` : ""}</p>}</div><button type="button" className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--paper)]" aria-label={`Remove ${item.file.name}`} onClick={() => setUploads(current => current.filter((_,i)=>i!==index))}><X size={15}/></button></li>)}</ul>}<p className="rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, and EML · 10 MB each, 20 MB total, 10 files. Extracted page or sheet references are shown with findings. Image-only PDFs need OCR, which this version does not provide. Original files are stored in private company storage and deleted when you delete the request. Request content and extracted text go to the configured AI provider; no numeric effort is generated by AI.</p><button className={button} disabled={!!busy || processingUploads || uploads.some(item=>!!item.error||!item.result) || !data?.aiReady || (text.trim().length < 30 && uploads.length === 0)}><WandSparkles size={16} />Analyze request</button>{!data?.aiReady && <p className="text-sm text-amber-800">Configure the server-side OpenAI key to analyze requests. Your text and files are not saved until analysis can start.</p>}</form></Section>}
          {request && review && <>
            <Section title={request.title} description={`${typeLabel[request.analysis?.requestType ?? request.review.requestType] ?? "Client request"} · received ${new Date(request.createdAt).toLocaleString()} · revision ${request.version}`}>
              <Progress request={request} />
              {request.analysisError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p>{request.analysisError}</p><button className="mt-2 font-medium underline" disabled={!!busy} onClick={() => void action({ action: "analyze", requestId: request.id, expectedVersion: request.version }, "AI analysis completed. Review its findings.")}>Retry AI analysis</button></div>}
              {request.analysis && <div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-[var(--paper)] p-4 md:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">AI summary · provisional</p><p className="mt-2 text-sm leading-6">{request.analysis.summary}</p><p className="mt-2 text-xs text-[var(--muted)]">Steps: {steps.join(" · ")} · {request.analysis.run.model} · {(request.analysis.run.elapsedMs / 1000).toFixed(1)}s</p></div>
                <div className="rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-semibold">Source-backed facts</h3>{request.analysis.facts.length ? <ul className="mt-3 space-y-3">{request.analysis.facts.map((fact, index) => <li key={index} className="border-t border-[var(--line)] pt-2"><p className="text-sm"><strong>{fact.key.replaceAll("_", " ")}:</strong> {fact.value} <span className="text-[10px] uppercase text-[var(--muted)]">{fact.status} · {fact.source}</span></p>{fact.evidence && <blockquote className="mt-1 border-l-2 border-neutral-400 pl-2 text-xs leading-5 text-[var(--muted)]">“{fact.evidence}”</blockquote>}</li>)}</ul> : <p className="mt-2 text-sm text-[var(--muted)]">No directly attributable facts were extracted.</p>}</div>
                <div className="rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-semibold">Product and capability fit</h3>{!company.knowledge.some(item => item.status === "approved") && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">No approved product knowledge is configured. Fit remains unknown.</p>}{request.analysis.productFindings.map((finding,index) => { const source=company.knowledge.find(item=>item.id===finding.sourceId); return <p key={index} className="mt-2 text-sm"><strong>{finding.status}:</strong> {finding.explanation}{source && <span className="mt-1 block text-xs text-[var(--muted)]">Source: {source.url ? <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}</span>}{finding.evidence && <span className="mt-1 block text-xs text-[var(--muted)]">“{finding.evidence}”</span>}</p>; })}{request.analysis.capabilityFindings.map((finding,index) => <p key={`cap-${index}`} className="mt-2 text-sm"><strong>{finding.capability} · {finding.status}:</strong> {finding.explanation}{finding.evidence && <span className="mt-1 block text-xs text-[var(--muted)]">“{finding.evidence}”</span>}</p>)}{!company.config.capabilities.length && <p className="mt-2 text-xs text-[var(--muted)]">Team capabilities have not been configured.</p>}</div>
                <div className="rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-semibold">Questions and risks</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm">{request.analysis.questions.map((item,index)=><li key={index}>{item}</li>)}{request.analysis.conflicts.map((item,index)=><li key={`conflict-${index}`}><strong>Conflict:</strong> {item}</li>)}{request.analysis.assumptions.map((item,index)=><li key={`assumption-${index}`}><strong>Assumption:</strong> {item}</li>)}</ul></div>
                <details className="rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer text-sm font-semibold">Original request and sources</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--muted)]">{request.text || "No pasted message."}</pre>{request.attachments.length > 0 && <ul className="mt-3 space-y-2">{request.attachments.map(file=><li key={file.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs"><span className="min-w-0 break-all">{file.name} · {file.status.replaceAll("_", " ")} · {file.locators.join(", ") || "no page or sheet references"}{file.message ? ` · ${file.message}` : ""}</span><a className="shrink-0 underline" href={`/api/company-workspace?company=${encodeURIComponent(company.id)}&request=${encodeURIComponent(request.id)}&file=${encodeURIComponent(file.id)}`}>Download original</a></li>)}</ul>}</details>
              </div>}
            </Section>

            {request.analysis && <Section title="Human scope review" description="Correct deliverables, exclusions, acceptance, dependencies and task packages. Saving edits clears the previous scope confirmation.">
              <div className="mb-4"><Field name="Reviewed work domain"><input className={input} disabled={!canEstimate || !editing || request.status === "frozen"} value={review.domain ?? ""} maxLength={100} onChange={event => setReview(current => current && ({ ...current, domain: event.target.value, confirmed: false }))}/></Field></div>
              <div className="mb-4 grid gap-4 md:grid-cols-2">{company.config.fields.filter(field => field.requestTypes.includes(review.requestType)).sort((a,b) => (a.priority ?? 5) - (b.priority ?? 5)).map(field => <Field key={field.key} name={`${field.label}${field.required ? " · required" : ""}`}><textarea className={input} rows={2} maxLength={2000} disabled={!canEstimate || !editing || request.status === "frozen"} value={review.fieldAnswers?.[field.key] ?? ""} onChange={event => setReview(current => current && ({ ...current, fieldAnswers: { ...current.fieldAnswers, [field.key]: event.target.value }, confirmed: false }))}/></Field>)}</div>
              {request.attachments.some(file => file.status !== "extracted" || file.truncated) && <label className="mb-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm"><input type="checkbox" disabled={!canEstimate || !editing || request.status === "frozen"} checked={review.sourceLimitationsAcknowledged ?? false} onChange={event => setReview(current => current && ({ ...current, sourceLimitationsAcknowledged: event.target.checked, confirmed: false }))}/>I reviewed the incomplete original sources and reconciled their limitations in this scope.</label>}
              <div className="grid gap-4 md:grid-cols-2"><Field name="Request type"><select className={input} disabled={!canEstimate || !editing || request.status === "frozen"} value={review.requestType} onChange={event => setReview(current => current && ({ ...current, requestType: event.target.value as ScopeReview["requestType"], confirmed: false }))}>{types.map(item => <option key={item} value={item}>{typeLabel[item]}</option>)}</select></Field><Field name="Product fit"><select className={input} disabled={!editing || request.status === "frozen"} value={review.productId} onChange={event => setReview(current => current && ({ ...current, productId: event.target.value, confirmed: false }))}><option value="">Unknown / not configured</option>{company.config.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
                <Field name="Deliverables"><textarea className={input} rows={4} disabled={!editing || request.status === "frozen"} value={review.deliverables} onChange={event => setReview(current => current && ({ ...current, deliverables: event.target.value, confirmed: false }))} /></Field><Field name="Exclusions"><textarea className={input} rows={4} disabled={!editing || request.status === "frozen"} value={review.exclusions} onChange={event => setReview(current => current && ({ ...current, exclusions: event.target.value, confirmed: false }))} /></Field><Field name="Acceptance criteria"><textarea className={input} rows={4} disabled={!editing || request.status === "frozen"} value={review.acceptance} onChange={event => setReview(current => current && ({ ...current, acceptance: event.target.value, confirmed: false }))} /></Field><Field name="Dependencies and owners"><textarea className={input} rows={4} disabled={!editing || request.status === "frozen"} value={review.dependencies} onChange={event => setReview(current => current && ({ ...current, dependencies: event.target.value, confirmed: false }))} /></Field></div>
              <div className="mt-5"><h3 className="text-sm font-semibold">Work packages</h3><div className="mt-3 space-y-3">{review.workPackages.map((item,index)=><WorkPackageEditor key={item.id} item={item} index={index} templates={company.config.tasks} disabled={!editing || request.status === "frozen"} onChange={next => setReview(current => current && ({ ...current, workPackages: current.workPackages.map((packageItem,i)=>i===index?next:packageItem), confirmed:false }))} onRemove={() => setReview(current => current && ({ ...current, workPackages: current.workPackages.filter((_,i)=>i!==index), confirmed:false }))} />)}</div>{editing && <button className={secondary + " mt-3"} type="button" onClick={() => { const template=company.config.tasks[0]; if (!template) return; const item: ScopeWorkPackage={id:crypto.randomUUID(),taskId:template.id,title:template.label,quantity:1,complexity:"medium",owner:"company",acceptance:"",dependencies:""}; setReview(current=>current&&({...current,workPackages:[...current.workPackages,item],confirmed:false})); }}><Plus size={14} />Add work package</button>}</div>
              {review.questions.length > 0 && <div className="mt-5 rounded-xl bg-amber-50 p-4"><h3 className="text-sm font-semibold text-amber-950">Open questions</h3><ul className="mt-2 list-inside list-disc text-sm text-amber-900">{review.questions.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}
              <div className="mt-5 flex flex-wrap items-center gap-2">{editing ? <><button className={button} disabled={!canEstimate || !!busy || !unsavedScope} onClick={() => void action({ action:"saveReview",requestId:request.id,expectedVersion:request.version,review },"Scope changes saved. Confirm them before estimating.")}><Check size={15} />Save scope changes</button><button className={secondary} onClick={() => { setReview(structuredClone(request.review)); setEditing(false); }}>Cancel</button></> : <button className={secondary} disabled={!canEstimate || request.status === "frozen" || !!busy} onClick={() => setEditing(true)}>Edit reviewed scope</button>}
                {!review.confirmed && request.status !== "frozen" && <button className={button} disabled={!canEstimate || !!busy || editing || !review.deliverables.trim()} onClick={() => void action({ action:"confirmScope",requestId:request.id,expectedVersion:request.version,confirmed:true },"Scope confirmed. You can now calculate effort.")}><ShieldCheck size={15} />Confirm scope</button>}
                {review.confirmed && request.status !== "frozen" && <p className="inline-flex items-center gap-2 text-sm text-green-800"><CheckCircle2 size={16} />Scope confirmed by {review.confirmedBy}</p>}
              </div>
            </Section>}

            {review.confirmed && request.status !== "frozen" && <Section title="Explainable effort plan" description="Effort is calculated from configured task templates and reviewer-selected complexity. It is a planning range, not a calibrated prediction or calendar promise.">
              {!request.estimate ? <button className={button} disabled={!canEstimate || !!busy || !review.workPackages.length} onClick={() => void action({ action:"estimate",requestId:request.id,expectedVersion:request.version },"Effort range calculated from the current task configuration.")}><Sparkles size={15} />Calculate effort</button> : <><EstimateTable estimate={request.estimate} /><button className={button + " mt-4"} disabled={!canEstimate || !!busy} onClick={() => void action({ action:"freeze",requestId:request.id,expectedVersion:request.version },"Reviewed estimate frozen as an immutable baseline.")}><ShieldCheck size={15} />Freeze estimate</button></>}
            </Section>}
            {request.baselines.length > 0 && <Section title="Frozen estimate baseline" description="This snapshot preserves the reviewed scope, task configuration version and planning range.">{request.baselines.map(base=><div key={base.id} className="mb-3 rounded-xl bg-[var(--paper)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Baseline v{base.revision}</strong><span className="text-xs text-[var(--muted)]">{new Date(base.createdAt).toLocaleString()} · configuration v{base.configVersion}</span></div><p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">SHA-256 {base.sha256}</p><p className="mt-3 text-sm">Effort: {base.estimate.lowHours}–{base.estimate.highHours} h · central {base.estimate.baseHours} h · {base.estimate.calibration}</p></div>)}</Section>}
            {request.status === "frozen" && <DeliveryPanel key={request.id} company={company} request={request} actorId={data!.actorId} busy={!!busy} action={body => action(body,"Delivery review updated.")}/>}
            <button className="text-xs font-medium text-red-800 underline" type="button" disabled={!canEstimate || request.status === "frozen" || !!busy} onClick={() => { if (window.confirm(`Delete “${request.title}” and its attached files? This cannot be undone.`)) void action({action:"deleteRequest",requestId:request.id,expectedVersion:request.version},"Request and attached files deleted."); }}>Delete request and files</button>
          </>}
          {!creatingRequest && !request && <Section title="From request to reviewed estimate" description="A human reviews the source-backed scope before the system calculates effort."><p className="text-sm leading-7 text-[var(--muted)]">Choose a request to review its evidence, questions, risks, assumptions, scope and task breakdown. No findings become a commitment until you confirm the scope and freeze a baseline.</p></Section>}
        </div>
      </div>}

      {panel === "settings" && <ConfigurationPanel key={`${company.id}:${company.version}`} company={company} busy={!!busy} save={config => action({ action:"saveConfiguration",expectedVersion:company.version,config },"Versioned company configuration saved.")} />}
      {panel === "knowledge" && <KnowledgePanel key={`${company.id}:${company.version}`} company={company} busy={!!busy} action={body => action(body,"Company knowledge updated.")} />}
      {panel === "members" && <MembersPanel company={company} actorId={data!.actorId} busy={!!busy} action={body => action(body,"Organization access updated.")}/>}
      {panel === "connectors" && <ConnectorsPanel company={company} busy={!!busy} action={body => action(body,"Connector settings updated.")}/>}
      {panel === "audit" && <AuditPanel company={company}/>}
      {panel === "evaluation" && <EvaluationPanel company={company}/>}
    </>}
    </div>
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-estimator-line py-5 text-xs leading-6 text-estimator-muted"><div><p className="max-w-2xl">Source-backed scope. Human review. Explainable effort.</p>{data && !company && <details className="mt-2"><summary>Your Site account ID</summary><code className="mt-2 block max-w-sm break-all">{data.actorId}</code></details>}</div><Link href="/" className="inline-flex items-center gap-2 hover:text-estimator-ink">The Estimator<Layers3 size={14}/></Link></footer>
  </main>;
}

function WorkPackageEditor({ item, index, templates, disabled, onChange, onRemove }: { item: ScopeWorkPackage; index: number; templates: CompanyConfig["tasks"]; disabled: boolean; onChange: (value: ScopeWorkPackage) => void; onRemove: () => void }) {
  return <div className="rounded-xl border border-[var(--line)] p-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_90px_110px]"><Field name={`Package ${index + 1}`}><input className={input} disabled={disabled} value={item.title} onChange={event=>onChange({...item,title:event.target.value})} /></Field><Field name="Task template"><select className={input} disabled={disabled} value={item.taskId} onChange={event=>{const template=templates.find(task=>task.id===event.target.value);onChange({...item,taskId:event.target.value,title:template?.label??item.title});}}>{templates.map(template=><option key={template.id} value={template.id}>{template.label}</option>)}</select></Field><Field name="Quantity"><input className={input} type="number" min="0.1" max="100" step="0.1" disabled={disabled} value={item.quantity} onChange={event=>onChange({...item,quantity:Number(event.target.value)})}/></Field><Field name="Complexity"><select className={input} disabled={disabled} value={item.complexity} onChange={event=>onChange({...item,complexity:event.target.value as ScopeWorkPackage["complexity"]})}><option>low</option><option>medium</option><option>high</option></select></Field></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Field name="Prerequisites and owner"><div className="flex flex-col gap-2 sm:flex-row"><select className={input} disabled={disabled} value={item.owner} onChange={event=>onChange({...item,owner:event.target.value as ScopeWorkPackage["owner"]})}><option value="company">Company</option><option value="customer">Customer</option><option value="vendor">Vendor</option></select><input className={input} disabled={disabled} value={item.dependencies} onChange={event=>onChange({...item,dependencies:event.target.value})} placeholder="Dependency details" /></div></Field><Field name="Acceptance criteria"><input className={input} disabled={disabled} value={item.acceptance} onChange={event=>onChange({...item,acceptance:event.target.value})} placeholder="How will delivery be accepted?" /></Field></div>{!disabled&&<button className="mt-3 text-xs font-medium text-red-800 underline" type="button" onClick={onRemove}>Remove package</button>}</div>;
}

function EstimateTable({ estimate }: { estimate: NonNullable<ClientRequest["estimate"]> }) {
  return <><div className="mb-4 grid gap-3 sm:grid-cols-3"><Metric label="Planning range" value={`${estimate.lowHours}–${estimate.highHours} h`} /><Metric label="Central effort" value={`${estimate.baseHours} h`} /><Metric label="Calibration" value="Uncalibrated" /></div><div className="overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full min-w-[620px] whitespace-normal text-left text-sm"><thead className="bg-[var(--paper)] text-xs text-[var(--muted)]"><tr><th className="p-3">Work package</th><th className="p-3">Quantity</th><th className="p-3">Base hours</th><th className="p-3">Range</th></tr></thead><tbody>{estimate.tasks.map((task,index)=><tr className="border-t border-[var(--line)]" key={`${task.templateId}-${index}`}><td className="min-w-60 p-3"><strong>{task.label}</strong><ul className="mt-1 text-xs leading-5 text-[var(--muted)]">{task.assumptions.map(item=><li key={item}>{item}</li>)}</ul></td><td className="p-3">{task.quantity} · {task.complexity}</td><td className="p-3">{task.baseHours} h</td><td className="p-3">{task.lowHours}–{task.highHours} h</td></tr>)}</tbody></table></div><p className="mt-3 text-xs leading-5 text-[var(--muted)]">Calendar delivery dates also depend on staffing availability, client response time and vendor prerequisites. Those values are not estimated here.</p></>;
}
function Metric({ label: caption, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[var(--paper)] p-3"><p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{caption}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }

function ConfigurationPanel({ company, busy, save }: { company: Company; busy: boolean; save: (config: CompanyConfig) => Promise<WorkspaceResponse | undefined> }) {
  const [fields, setFields] = useState(JSON.stringify(company.config.fields,null,2));
  const [products, setProducts] = useState(JSON.stringify(company.config.products,null,2));
  const [tasks, setTasks] = useState(JSON.stringify(company.config.tasks,null,2));
  const [capabilities, setCapabilities] = useState(company.config.capabilities.join("\n"));
  const [parseError, setParseError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); try { setParseError(""); const config: CompanyConfig={...company.config,fields:JSON.parse(fields),products:JSON.parse(products),tasks:JSON.parse(tasks),capabilities:capabilities.split("\n").map(item=>item.trim()).filter(Boolean)}; await save(config); } catch(cause) { setParseError(cause instanceof Error?cause.message:"Settings must be valid JSON."); } }
  return <Section title="Company workflow settings" description={`Configuration v${company.config.version}. Request and estimate snapshots retain the version that was active when they were frozen.`}><form className="space-y-4" onSubmit={submit}><fieldset className="space-y-4" disabled={busy || company.role !== "admin"}><div className="grid gap-4 md:grid-cols-2"><Field name="Conditional request fields · JSON"><textarea className={input+" font-mono text-xs"} rows={10} value={fields} onChange={event=>setFields(event.target.value)} /><span className="mt-1 block text-[10px]">Each item: key, label, requestTypes, required, optional priority (1–10)</span></Field><Field name="Product catalog · JSON"><textarea className={input+" font-mono text-xs"} rows={10} value={products} onChange={event=>setProducts(event.target.value)} /><span className="mt-1 block text-[10px]">Each item: id, name, description. Do not add unsupported capability claims.</span></Field><Field name="Task templates and effort assumptions · JSON"><textarea className={input+" font-mono text-xs"} rows={12} value={tasks} onChange={event=>setTasks(event.target.value)} /><span className="mt-1 block text-[10px]">Each item: id, label, baseHours, lowFactor (≤1), highFactor (≥1)</span></Field><Field name="Team capabilities"><textarea className={input} rows={12} value={capabilities} onChange={event=>setCapabilities(event.target.value)} placeholder="One approved team skill per line" /><span className="mt-1 block text-[10px]">Unknown capabilities stay unknown until configured here.</span></Field></div>{parseError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{parseError}</p>}<button className={button} disabled={busy}><Settings2 size={15}/>Save versioned settings</button></fieldset></form></Section>;
}

function KnowledgePanel({ company, busy, action }: { company: Company; busy: boolean; action: (body: Record<string, unknown>) => Promise<WorkspaceResponse | undefined> }) {
  const [title, setTitle] = useState(""); const [url, setUrl] = useState(""); const [text, setText] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const result=await action({action:"addKnowledge",expectedVersion:company.version,title,url,text}); if(result){setTitle("");setUrl("");setText("");} }
  return <div className="grid gap-5 lg:grid-cols-2"><Section title="Add approved company knowledge" description="Paste an official or administrator-authorized source excerpt. New entries remain drafts until an administrator approves them."><form className="space-y-3" onSubmit={submit}><fieldset className="space-y-4" disabled={busy || company.role !== "admin"}><Field name="Source title"><input className={input} minLength={2} maxLength={200} required value={title} onChange={event=>setTitle(event.target.value)}/></Field><Field name="Source URL (optional for internal material)"><input className={input} type="url" maxLength={2000} value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://docs.example.com/..."/></Field><Field name="Source text"><textarea className={input} rows={8} minLength={30} maxLength={100000} required value={text} onChange={event=>setText(event.target.value)} placeholder="Paste the passage or content to make available to AI analysis…"/></Field><p className="rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">Only approved knowledge is supplied to analysis. Each version retains its source title, URL, approval time and SHA-256 digest.</p><button className={button} disabled={busy}>Add draft source</button></fieldset></form></Section><Section title="Approved knowledge library" description="Only active approved versions can support product-fit findings.">{company.knowledge.length? <div className="space-y-3">{company.knowledge.map(source=><article key={source.id} className="rounded-xl border border-[var(--line)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{source.title}</strong><span className={`rounded-full px-2 py-1 text-[10px] uppercase ${source.status==="approved"?"bg-green-50 text-green-800":source.status==="draft"?"bg-amber-50 text-amber-900":"bg-neutral-100 text-neutral-600"}`}>{source.status}</span></div>{source.url&&<a className="mt-1 block break-all text-xs underline" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>}<p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{source.text}</p><p className="mt-2 break-all font-mono text-[10px] text-[var(--muted)]">SHA-256 {source.sha256}</p>{source.approvedAt&&<p className="mt-1 text-[10px] text-[var(--muted)]">Approved {new Date(source.approvedAt).toLocaleString()} by {source.approvedBy}</p>}<div className="mt-3 flex gap-2">{company.role==="admin"&&source.status==="draft"&&<button className={secondary} disabled={busy} onClick={()=>void action({action:"approveKnowledge",expectedVersion:company.version,knowledgeId:source.id})}>Approve source</button>}{company.role==="admin"&&source.status==="approved"&&<button className={secondary} disabled={busy} onClick={()=>void action({action:"retireKnowledge",expectedVersion:company.version,knowledgeId:source.id})}>Retire version</button>}</div></article>)}</div>:<p className="text-sm text-[var(--muted)]">No knowledge sources yet. Add a draft and approve it before use.</p>}</Section></div>;
}
