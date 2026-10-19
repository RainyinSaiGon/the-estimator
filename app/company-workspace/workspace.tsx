"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Check, CheckCircle2, ChevronDown, ClipboardList, FileText, History, Layers3, Loader2, Plug, Plus, Search, Settings2, ShieldCheck, Sparkles, Users, WandSparkles, X } from "lucide-react";
import type { ClientRequest, Company, CompanyConfig, CompanyMember, RequestTaskTracking, ScopeReview, ScopeWorkPackage, TaskMilestone, WorkspaceResponse } from "../../lib/client-workflow-types";
import { extractClientFile, type ExtractedUpload } from "../../lib/browser-document-extraction";
import { configuredProductId } from "../../lib/workflow-product-selection";

import { AuditPanel, ConnectorsPanel, DeliveryPanel, EvaluationPanel, MembersPanel } from "./governance";
import { button, secondary, input, label, card, Section } from "./ui";

type Panel = "requests" | "knowledge" | "settings" | "evaluation" | "members" | "connectors" | "audit";
const panels = [
  { id: "requests", title: "Client work", icon: ClipboardList },
  { id: "knowledge", title: "Knowledge sources", icon: FileText },
  { id: "settings", title: "Company settings", icon: Settings2 },
  { id: "members", title: "Members", icon: Users },
  { id: "connectors", title: "Connectors", icon: Plug },
  { id: "evaluation", title: "Review & results", icon: ShieldCheck },
  { id: "audit", title: "Audit", icon: History },
] as const;
const settingsGroups = [
  { title: "Company configuration", ids: ["knowledge", "settings"] },
  { title: "People & access", ids: ["members"] },
  { title: "Integrations", ids: ["connectors"] },
  { title: "Governance", ids: ["audit"] },
] as const;
const types = ["demo", "setup", "migration", "integration", "customization", "support"] as const;
const typeLabel: Record<string, string> = { demo: "Demo inquiry", setup: "Product setup", migration: "Migration", integration: "Integration", customization: "Customization", support: "Support" };
type UploadItem = { file: File; result?: ExtractedUpload; error?: string };

function requestStatusLabel(status: ClientRequest["status"]) {
  return ({ received: "Brief received", analyzing: "AI analyzing", needs_review: "Needs review", scope_confirmed: "Scope approved", estimated: "Effort calculated", frozen: "Plan committed", analysis_failed: "Analysis needs retry" })[status];
}

function requestStatusTone(status: ClientRequest["status"]) {
  if (status === "frozen") return "bg-emerald-100 text-emerald-900";
  if (status === "analysis_failed") return "bg-red-100 text-red-900";
  if (status === "estimated" || status === "scope_confirmed") return "bg-violet-100 text-violet-900";
  if (status === "analyzing") return "bg-sky-100 text-sky-900";
  return "bg-amber-100 text-amber-950";
}

function Field({ name, children }: { name: string; children: ReactNode }) { return <label className={label}>{name}{children}</label>; }
type QuestionResolution = NonNullable<ScopeReview["questionResolutions"]>[string];
type FindingReview = NonNullable<ScopeReview["findingReviews"]>[string];
function QuestionReviewEditor({ question, value, disabled, onChange, onRemove }: { question: string; value?: QuestionResolution; disabled: boolean; onChange: (value: QuestionResolution) => void; onRemove?: () => void }) {
  return <article className="rounded-xl border border-amber-200 bg-white p-3">
    <div className="flex items-start justify-between gap-3"><p className="min-w-0 text-sm leading-6">{question}</p>{onRemove && <button className="shrink-0 text-xs font-medium text-red-800 underline" type="button" disabled={disabled} onClick={onRemove}>Remove</button>}</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <Field name="Review status"><select className={input} disabled={disabled} value={value?.disposition ?? ""} onChange={event => onChange({ ...value, disposition: (event.target.value || undefined) as QuestionResolution["disposition"], resolution: value?.resolution ?? "", ...(value?.question ? { question: value.question } : {}) })}><option value="">Needs a decision</option><option value="answered">Answered</option><option value="not_applicable">Not applicable</option></select></Field>
      <Field name="Answer or reason it does not apply"><textarea className={input} rows={2} disabled={disabled} required value={value?.resolution ?? ""} onChange={event => onChange({ ...value, resolution: event.target.value, ...(value?.question ? { question: value.question } : {}) })} placeholder="Record the decision or remaining prerequisite…" /></Field>
    </div>
  </article>;
}
function FindingReviewEditor({ value, disabled, onChange }: { value?: FindingReview; disabled: boolean; onChange: (value: FindingReview) => void }) {
  return <div className="mt-3 grid gap-3 sm:grid-cols-2">
    <Field name="Reviewer decision"><select className={input} disabled={disabled} value={value?.disposition ?? ""} onChange={event => onChange({ ...value, disposition: (event.target.value || undefined) as FindingReview["disposition"], correction: value?.correction ?? "" })}><option value="">Needs a decision</option><option value="accepted">Accept finding</option><option value="corrected">Correct finding</option><option value="rejected">Reject finding</option></select></Field>
    {(value?.disposition === "corrected" || value?.disposition === "rejected") && <Field name={value.disposition === "corrected" ? "Correction" : "Reason for rejection"}><textarea className={input} rows={2} required disabled={disabled} value={value.correction} onChange={event => onChange({ ...value, correction: event.target.value })} placeholder="Keep the reviewer’s correction separate from the AI result…" /></Field>}
  </div>;
}
function reviewForEditor(request: ClientRequest, products: CompanyConfig["products"]): ScopeReview {
  const review = structuredClone(request.review);
  if (request.status !== "frozen") review.productId = configuredProductId(review.productId, products);
  return review;
}

async function api(body?: Record<string, unknown> | FormData, companyId?: string): Promise<WorkspaceResponse> {
  const url = companyId ? `/api/company-workspace?company=${encodeURIComponent(companyId)}` : "/api/company-workspace";
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(url, body ? { method: "POST", headers: isForm ? undefined : { "content-type": "application/json" }, body: isForm ? body : JSON.stringify(body), cache: "no-store" } : { cache: "no-store" });
  const data = await response.json() as WorkspaceResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "The workspace request failed.");
  return data;
}

function Progress({ request }: { request: ClientRequest }) {
  const steps = ["Brief & AI analysis", "Review scope", "Calculate effort", "Commit & track"];
  const current = request.status === "received" || request.status === "analyzing" || request.status === "analysis_failed" ? 1 : request.status === "needs_review" ? 2 : request.status === "scope_confirmed" || request.status === "estimated" ? 3 : 4;
  return <div aria-label="Request progress" className="rounded-xl border border-estimator-line bg-estimator-canvas/70 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-estimator-muted">Workflow progress</p><p className="text-xs font-medium text-estimator-ink">Step {current} of {steps.length} · {steps[current - 1]}</p></div>
    <ol className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">{steps.map((step, index) => <li key={step} aria-current={index + 1 === current ? "step" : undefined} className="min-w-0"><div className={`mb-2 h-1.5 rounded-full ${index + 1 < current ? "bg-estimator-ink" : index + 1 === current ? "bg-estimator-accent" : "bg-estimator-line"}`} /><span className={`text-[10px] leading-4 sm:text-xs ${index + 1 <= current ? "font-medium text-estimator-ink" : "text-estimator-muted"}`}>{step}</span></li>)}</ol>
  </div>;
}

export default function CompanyWorkspace({ userName, guest = false, publicDemo = false }: { userName: string; guest?: boolean; publicDemo?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [panel, setPanel] = useState<Panel>("requests");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const [companyId, setCompanyId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [requestView, setRequestView] = useState<"list" | "detail">("list");
  const [requestQuery, setRequestQuery] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const startRequestAfterCompany = useRef(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [reviewerQuestion, setReviewerQuestion] = useState("");
  const [cohort, setCohort] = useState<"synthetic" | "recorded">("synthetic");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [processingUploads, setProcessingUploads] = useState(false);
  const company = data?.company ?? null;
  const canEstimate = !!company && ["admin", "estimator"].includes(company.role);
  const request = company?.requests.find(item => item.id === requestId) ?? null;
  const sampleRequest = publicDemo ? company?.requests.find(item => item.cohort === "synthetic" && item.analysis) : undefined;
  const visibleRequests = company?.requests.filter(item => {
    const query = requestQuery.trim().toLocaleLowerCase();
    return !query || [item.title, item.text, item.status, typeLabel[item.review.requestType] ?? item.review.requestType]
      .some(value => value.toLocaleLowerCase().includes(query));
  }) ?? [];
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
      setRequestId(current => nextCompany?.requests.some(item => item.id === current) ? current : "");
      if (nextCompany && startRequestAfterCompany.current) {
        setPanel("requests"); setCreatingCompany(false); setCreatingRequest(true); setRequestId(""); setRequestView("detail");
        startRequestAfterCompany.current = false;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open company workspace."); }
    finally { setBusy(""); }
  }, [companyId, guest]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!settingsOpen) return;
    const items = [...(settingsMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (document.activeElement === settingsTriggerRef.current) items[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !settingsMenuRef.current?.contains(event.target)) setSettingsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        settingsTriggerRef.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) return;
      const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : activeIndex < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0) : event.key === "ArrowDown" ? (activeIndex + 1) % items.length : (activeIndex - 1 + items.length) % items.length;
      event.preventDefault();
      items[nextIndex].focus();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has("new") || query.has("view")) {
      query.delete("new");
      query.delete("view");
      const queryString = query.toString();
      const suffix = queryString ? `?${queryString}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${suffix}`);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!request) { setReview(null); setReviewerQuestion(""); return; }
      setReview(reviewForEditor(request, company?.config.products ?? [])); setEditing(false);
      setReviewerQuestion("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [request, company?.config.products]);

  async function run(name: string, work: () => Promise<WorkspaceResponse>) {
    setBusy(name); setError(""); setNotice("");
    try {
      const next = await work();
      setData(next);
      const nextCompany = next.company;
      if (nextCompany) {
        setCompanyId(nextCompany.id);
        setRequestId(current => nextCompany.requests.some(item => item.id === current) ? current : "");
        if (startRequestAfterCompany.current) {
          setPanel("requests"); setCreatingCompany(false); setCreatingRequest(true); setRequestId(""); setRequestView("detail");
          startRequestAfterCompany.current = false;
        }
      }
      return next;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workspace request failed."); return undefined; }
    finally { setBusy(""); }
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    const next = await run("company", () => api({ action: "createCompany", name: companyName }));
    if (next?.company) { setCompanyName(""); setCreatingCompany(false); setPanel("requests"); setRequestView("list"); setNotice("Company workspace created. Add your request templates and approved knowledge when ready."); }
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
      setRequestView("detail");
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
  const questionResolutions = review?.questionResolutions ?? {};
  const findingReviews = review?.findingReviews ?? {};
  const questionRows = request?.analysis?.questions.map((question, index) => ({
    key: `analysis:${index}`,
    question,
    value: questionResolutions[`analysis:${index}`],
  })) ?? [];
  const reviewerQuestionRows = Object.entries(questionResolutions)
    .filter(([key, value]) => key.startsWith("review:") && value.question?.trim())
    .map(([key, value]) => ({ key, question: value.question!, value }));
  const unresolvedQuestions = [...questionRows, ...reviewerQuestionRows].filter(({ value }) =>
    !value?.disposition || !value.resolution.trim(),
  ).length;
  const findingKeys = request?.analysis ? [
    ...request.analysis.facts.map((_, index) => `fact:${index}`),
    ...request.analysis.productFindings.map((_, index) => `product:${index}`),
    ...request.analysis.capabilityFindings.map((_, index) => `capability:${index}`),
    ...request.analysis.assumptions.map((_, index) => `assumption:${index}`),
    ...request.analysis.conflicts.map((_, index) => `conflict:${index}`),
  ] : [];
  const unreviewedFindings = findingKeys.filter(key => {
    const finding = findingReviews[key];
    return !finding?.disposition || ((finding.disposition === "corrected" || finding.disposition === "rejected") && !finding.correction.trim());
  }).length;
  const missingRequiredFields = review && company ? company.config.fields.filter(field =>
    field.required && field.requestTypes.includes(review.requestType) && !review.fieldAnswers?.[field.key]?.trim(),
  ).map(field => field.label) : [];
  const reviewBlockers = review ? [
    ...(!review.deliverables.trim() ? ["Add at least one deliverable."] : []),
    ...(!review.domain?.trim() ? ["Set the reviewed work domain."] : []),
    ...(!review.acceptance.trim() ? ["Write the overall completion criteria."] : []),
    ...(!review.dependencies.trim() ? ["State the prerequisites and owners, or enter “None identified.”"] : []),
    ...(review.workPackages.length === 0 ? ["Add at least one work package."] : []),
    ...(review.workPackages.some(item => !item.acceptance.trim()) ? ["Add completion criteria to each work package."] : []),
    ...(review.workPackages.some(item => !item.dependencies.trim()) ? ["State prerequisites for each work package, or enter “None identified.”"] : []),
    ...(unresolvedQuestions ? [`Resolve all ${unresolvedQuestions} open question${unresolvedQuestions === 1 ? "" : "s"}.`] : []),
    ...(unreviewedFindings ? [`Review all ${unreviewedFindings} AI finding${unreviewedFindings === 1 ? "" : "s"}.`] : []),
    ...(missingRequiredFields.length ? [`Complete required fields: ${missingRequiredFields.join(", ")}.`] : []),
    ...(request?.attachments.some(file => file.status !== "extracted" || file.truncated) && !review.sourceLimitationsAcknowledged ? ["Reconcile incomplete source files and acknowledge their limitations."] : []),
  ] : [];

  function changeQuestionResolution(key: string, value: NonNullable<ScopeReview["questionResolutions"]>[string]) {
    setReview(current => current && ({ ...current, questionResolutions: { ...current.questionResolutions, [key]: value }, confirmed: false }));
  }
  function changeFindingReview(key: string, value: NonNullable<ScopeReview["findingReviews"]>[string]) {
    setReview(current => current && ({ ...current, findingReviews: { ...current.findingReviews, [key]: value }, confirmed: false }));
  }

  if (guest) return <main className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-5 py-12 font-sans sm:px-8"><section className={card + " w-full text-center !p-8 sm:!p-12"}><Sparkles className="mx-auto mb-4" /><p className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">Company request workflow</p><h1 className="mt-2 text-3xl font-medium tracking-tight">Sign in to open your workspace</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--muted)]">Requests, evidence and frozen estimates are available only to your signed-in workspace.</p><a className={button + " mt-6"} href="/signin-with-chatgpt?return_to=%2Fcompany-workspace" onClick={event => { event.preventDefault(); const newRequest = startRequestAfterCompany.current || new URLSearchParams(window.location.search).get("new") === "1"; const returnTo = newRequest ? "/company-workspace?new=1" : "/company-workspace"; router.push(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`); }}>Sign in with ChatGPT</a></section></main>;

  return <main id="company-main" className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-6 font-sans sm:px-8 lg:px-10">
    <a className="sr-only focus:not-sr-only focus:mb-4 focus:rounded-full focus:bg-estimator-ink focus:px-4 focus:py-3 focus:text-white" href="#company-content">Skip to workspace content</a>
    <header className="mb-6 flex items-center justify-between gap-4 border-b border-estimator-line pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-estimator-ink text-white"><Layers3 size={18} /></span>
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-estimator-muted">The Estimator</p><h1 className="mt-1 break-words text-lg font-semibold leading-tight tracking-tight sm:text-xl">{company?.name ?? "AI request workspace"}</h1></div>
      </div>
      <p className="max-w-40 truncate text-xs text-estimator-muted sm:max-w-none">{publicDemo ? "Interactive demo" : userName}</p>
    </header>
      {publicDemo && <aside role="note" className="mb-5 rounded-xl border border-estimator-line bg-estimator-paper px-4 py-3 text-xs leading-5 text-estimator-muted"><strong className="font-semibold text-estimator-ink">Interactive demo · live AI.</strong> This workspace is shared. Use fictional client material; demo requests stay separate from real delivery results.
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer font-medium underline underline-offset-2">How to try the demo</summary>
        <ol className="mt-3 grid gap-x-6 gap-y-2 pl-5 text-xs leading-5 sm:grid-cols-2">
          <li><strong>Receive:</strong> open the fictional CRM migration request below, or create another fictional request. Live AI analysis uses the configured OpenAI service.</li>
          <li><strong>Review:</strong> inspect cited source evidence, findings, assumptions, product fit, and open questions. Correct the scope before continuing.</li>
          <li><strong>Estimate:</strong> confirm the reviewed scope to calculate task-by-task effort ranges, then commit the approved plan.</li>
          <li><strong>Track:</strong> open a frozen request to set task owners, statuses, dates, milestones and blockers. Actuals still need evidence and a different reviewer; the shared demo cannot stand in for that reviewer.</li>
          <li><strong>Evaluate:</strong> see AI analysis, human review decisions and next actions. Delivery results become available after independent review.</li>
          <li><strong>Connect:</strong> open Workspace settings → Integrations to rotate demo webhook credentials or create a read-only MCP token. These credentials are shared-demo only.</li>
        </ol>
      </details>
    </aside>}
    <div id="company-content" tabIndex={-1} className={`min-w-0 flex-1 ${!company ? "flex flex-col" : ""}`}>
    {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</div>}
    {notice && <div role="status" className="mb-5 rounded-xl bg-green-50 p-4 text-sm text-green-900">{notice}</div>}
    {creatingCompany && <div className="grid flex-1 place-items-center py-8"><form onSubmit={createCompany} className={card + " w-full max-w-xl"}><span className="mb-5 grid size-12 place-items-center rounded-2xl bg-estimator-signal text-estimator-signal-ink"><Layers3 size={23} /></span><p className="text-[10px] uppercase tracking-[.18em] text-estimator-muted">{publicDemo ? "Shared demo workspace" : "A home for your requests"}</p><h2 className="mt-2 text-2xl font-medium tracking-tight">{publicDemo ? "Create a fictional demo company" : "Create a company workspace"}</h2><p className="mb-6 mt-3 text-sm leading-6 text-estimator-muted">{publicDemo ? "Configure a fictional demo company." : "Start with generic request fields and planning templates."} Add your products, approved knowledge and team when you’re ready.</p><Field name="Company name"><input className={input} placeholder="e.g. Acme Consulting" value={companyName} minLength={2} maxLength={120} required onChange={event => setCompanyName(event.target.value)} /></Field><div className="mt-6 flex flex-wrap gap-2"><button className={button} disabled={!!busy}>Create workspace<ArrowLeft className="rotate-180" size={15}/></button><button type="button" className={secondary} onClick={() => setCreatingCompany(false)}>Cancel</button></div></form></div>}
    {data && !company && !creatingCompany && <div className="grid flex-1 place-items-center py-12"><section className={card + " w-full max-w-2xl text-center !p-8 sm:!p-12"}><span className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-estimator-signal text-estimator-signal-ink"><Layers3 size={27} /></span><p className="text-[10px] font-medium uppercase tracking-[.2em] text-estimator-muted">{publicDemo ? "Shared public demo" : "Your private workspace"}</p><h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">Good estimates start with context.</h2><p className="mx-auto mt-4 max-w-md text-sm leading-7 text-estimator-muted">Bring your company’s knowledge, request templates and delivery experience together. Then turn each client brief into a scope you can review.</p><button className={button + " mt-7"} onClick={() => setCreatingCompany(true)}><Plus size={16} />Create company workspace</button><p className="mt-4 text-xs text-estimator-muted">{publicDemo ? "Changes are visible to everyone using this demo." : "Private to your team. Built around your business."}</p></section></div>}
    {!data && !error && <div className="grid flex-1 place-items-center py-20"><p role="status" className="flex items-center gap-3 text-sm text-estimator-muted"><Loader2 size={18} className="animate-spin"/>Opening your company workspace…</p></div>}

    {company && !creatingCompany && <>
      <nav aria-label="Company sections" className="mb-5 flex items-center gap-2 border-b border-estimator-line pb-3">
        <div className="inline-flex items-center gap-1 rounded-xl bg-estimator-paper p-1">
        {panels.filter(({ id }) => id === "requests" || id === "evaluation").map(({ id, title, icon: Icon }) => {
          const className = `inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition sm:px-3 ${panel === id ? "bg-estimator-ink text-white shadow-sm" : "text-estimator-muted hover:bg-white hover:text-estimator-ink"}`;
          return <button key={id} aria-current={panel === id ? "page" : undefined} className={className} onClick={() => { setPanel(id); setSettingsOpen(false); setNotice(""); setError(""); }}><Icon size={16} className="hidden sm:block" />{title}</button>;
        })}
        </div>
        <div ref={settingsMenuRef} className="relative ml-auto">
          <button ref={settingsTriggerRef} type="button" aria-label="Workspace settings" aria-haspopup="menu" aria-expanded={settingsOpen} aria-controls="company-settings-menu" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition ${panels.some(({ id }) => id !== "requests" && id !== "evaluation" && id === panel) ? "bg-estimator-paper text-estimator-ink" : "text-estimator-muted hover:bg-estimator-paper hover:text-estimator-ink"}`} onClick={() => setSettingsOpen(value => !value)}>
            <Settings2 size={16} /><span className="hidden sm:inline">Workspace settings</span><ChevronDown size={14} aria-hidden="true" />
          </button>
          {settingsOpen && <div id="company-settings-menu" role="menu" aria-label="Workspace settings" className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-estimator-line bg-white p-2 shadow-xl">
            {settingsGroups.map(group => <section key={group.title} role="group" aria-label={group.title} className="py-1"><p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[.16em] text-estimator-muted">{group.title}</p>{panels.filter(({ id }) => group.ids.some(groupId => groupId === id)).map(({ id, title, icon: Icon }) => <button key={id} type="button" role="menuitem" aria-current={panel === id ? "page" : undefined} className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition ${panel === id ? "bg-estimator-ink text-white" : "text-estimator-ink hover:bg-estimator-paper"}`} onClick={() => { setPanel(id); setSettingsOpen(false); setNotice(""); setError(""); settingsTriggerRef.current?.focus(); }}><Icon size={16} />{title}{panel === id && <Check size={14} className="ml-auto" />}</button>)}</section>)}
          </div>}
        </div>
      </nav>
      {busy && <p className="mb-4 flex items-center gap-2 text-sm text-[var(--muted)]" role="status"><Loader2 size={15} className="animate-spin" />{busy === "receive" ? "Analyzing request with AI…" : busy === "analyze" ? "Retrying AI analysis…" : "Saving changes…"}</p>}

      {panel === "requests" && <>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {requestView === "list" ? <div className="max-w-2xl"><div className="flex items-center gap-2"><h2 className="text-2xl font-semibold tracking-tight">Client briefs</h2><span className="rounded-lg bg-estimator-paper px-2 py-1 text-xs font-medium text-estimator-muted">{company.requests.length}</span></div><p className="mt-2 text-sm leading-6 text-estimator-muted">AI turns each brief into facts, questions and suggested tasks. Review the scope, calculate effort, then commit and track delivery.</p></div> : <div><button type="button" className={secondary + " shrink-0 self-start"} onClick={() => { setRequestView("list"); setCreatingRequest(false); setError(""); setNotice(""); }}><ArrowLeft size={15}/>Back to client briefs</button><p className="mt-2 text-xs uppercase tracking-[.16em] text-estimator-muted">{creatingRequest ? "Add brief" : "Client brief"}</p></div>}
          {requestView === "list" && <div className="flex shrink-0 flex-wrap gap-2">{sampleRequest && <button className={secondary} onClick={() => { setCreatingRequest(false); setRequestId(sampleRequest.id); setRequestView("detail"); }}>Open sample brief</button>}<button disabled={!canEstimate} className={button} onClick={() => { setCreatingRequest(true); setRequestId(""); setRequestView("detail"); }}><Plus size={16}/>Add brief</button></div>}
        </div>
        <div className="min-w-0">
        {requestView === "list" && <section aria-label="Client brief inbox" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4"><label className="relative block w-full sm:max-w-sm"><span className="sr-only">Search client briefs</span><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-estimator-muted"/><input className={input + " mt-0 pl-9"} type="search" value={requestQuery} onChange={event => setRequestQuery(event.target.value)} placeholder="Search client briefs" /></label><p className="text-xs text-estimator-muted">{visibleRequests.length} of {company.requests.length} shown</p></div>
          <div className="max-h-[65vh] divide-y divide-estimator-line overflow-y-auto border-y border-estimator-line">{visibleRequests.map(item => {
            return <button key={item.id} aria-label={`Open brief: ${item.title}`} className="group flex w-full items-center gap-4 px-2 py-5 text-left transition hover:bg-estimator-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-estimator-accent sm:px-4" onClick={() => { setCreatingRequest(false); setRequestId(item.id); setRequestView("detail"); }}>
              <span className="min-w-0 flex-1"><strong className="block break-words text-sm font-semibold leading-6">{item.title}</strong><span className="mt-1 block text-xs leading-5 text-estimator-muted">{typeLabel[item.analysis?.requestType ?? item.review.requestType] ?? "Client brief"} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time> · {item.channel === "webhook" ? "Form submission" : "Added manually"}</span><span className={`mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-medium sm:hidden ${requestStatusTone(item.status)}`}>{requestStatusLabel(item.status)}</span></span>
              <span className={`hidden shrink-0 rounded-md px-2.5 py-1 text-xs font-medium sm:inline-flex ${requestStatusTone(item.status)}`}>{requestStatusLabel(item.status)}</span><ArrowLeft size={16} aria-hidden="true" className="rotate-180 text-estimator-muted"/>
            </button>;
          })}</div>
          {!company.requests.length && <div className="py-12 text-center"><h3 className="text-lg font-semibold">No client briefs yet</h3><p className="mt-2 text-sm leading-6 text-estimator-muted">{publicDemo ? "Add a fictional brief to try the full workflow." : "Add your first client brief to create an AI-drafted scope for review."}</p></div>}
          {company.requests.length > 0 && visibleRequests.length === 0 && <p className="rounded-xl bg-estimator-paper p-4 text-sm text-estimator-muted">No requests match “{requestQuery}”.</p>}
        </section>}
        {requestView === "detail" && <div className="min-w-0 space-y-5">
          {creatingRequest && <Section title="Add a client brief" description={publicDemo ? "Paste a fictional brief or attach sample documents. Live AI extracts evidence and drafts a scope for you to review before calculating effort." : "Paste the brief or attach source files. AI extracts evidence and drafts a scope; your team reviews it before the estimator calculates effort."}><form className="space-y-4" onSubmit={createRequest}><Field name="Brief title"><input className={input} value={title} required minLength={3} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="e.g. Investor onboarding and data migration" /></Field>{!publicDemo ? <Field name="Evidence cohort"><select className={input} value={cohort} onChange={event => setCohort(event.target.value as "synthetic" | "recorded")}><option value="synthetic">Synthetic / test request</option><option value="recorded">Recorded client request</option></select><span className="mt-1 block">This classification is frozen before actuals and cannot be changed afterward.</span></Field> : <div className="rounded-xl border border-estimator-line bg-estimator-paper p-3"><p className="text-sm font-medium">Synthetic demo request</p><p className="mt-1 text-xs leading-5 text-estimator-muted">Requests from this shared workspace are always marked synthetic and excluded from real delivery training.</p></div>}<Field name="Client brief"><textarea className={input} rows={8} value={text} maxLength={20000} onChange={event => setText(event.target.value)} placeholder="Paste the request email, form submission, or project brief…" /></Field><Field name="Add documents · PDF, Word, Excel, CSV, text, JSON, or email"><input className={input} type="file" multiple accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json,.eml" disabled={processingUploads || !!busy} onChange={event => { void chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} /></Field>{processingUploads && <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 size={15} className="animate-spin" />Reading file text and sheet or page references…</p>}{uploads.length > 0 && <ul className="space-y-2">{uploads.map((item,index)=><li key={`${item.file.name}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--line)] p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{item.file.name} <span className="font-normal text-[var(--muted)]">({(item.file.size/1024).toFixed(0)} KB)</span></p>{item.error ? <p className="mt-1 text-xs text-red-800">{item.error}</p> : item.result && <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.result.status.replaceAll("_", " ")} · {item.result.text.length.toLocaleString()} characters · {item.result.locators.length} references{item.result.truncated ? " · text shortened to 40,000 characters" : ""}{item.result.message ? ` · ${item.result.message}` : ""}</p>}</div><button type="button" className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--paper)]" aria-label={`Remove ${item.file.name}`} onClick={() => setUploads(current => current.filter((_,i)=>i!==index))}><X size={15}/></button></li>)}</ul>}<p className="rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, and EML · 10 MB each, 20 MB total, 10 files. Extracted page or sheet references are shown with findings. Image-only PDFs need OCR, which this version does not provide. {publicDemo ? "Files are visible to every visitor to this shared demo workspace; use fictional documents only." : "Original files are stored in private company storage and deleted when you delete the request."} Request content and extracted text go to the configured AI provider; no numeric effort is generated by AI.</p><button className={button} disabled={!!busy || processingUploads || uploads.some(item=>!!item.error||!item.result) || !data?.aiReady || (text.trim().length < 30 && uploads.length === 0)}><WandSparkles size={16} />Analyze brief</button>{!data?.aiReady && <p className="text-sm text-amber-800">Configure the server-side OpenAI key to analyze requests. Your text and files are not saved until analysis can start.</p>}</form></Section>}
          {request && review && <>
            <Section title={request.title} description={`${typeLabel[request.analysis?.requestType ?? request.review.requestType] ?? "Client request"} · received ${new Date(request.createdAt).toLocaleString()}`}>
              <Progress request={request} />
              {request.analysisError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p>{request.analysisError}</p><button className="mt-2 font-medium underline" disabled={!!busy} onClick={() => void action({ action: "analyze", requestId: request.id, expectedVersion: request.version }, "AI analysis completed. Review its findings.")}>Retry AI analysis</button></div>}
              {request.analysis && <div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-[var(--paper)] p-4 md:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">AI draft · review before committing</p><p className="mt-2 text-sm leading-6">{request.analysis.summary}</p><details className="mt-3 text-xs text-estimator-muted"><summary className="cursor-pointer">Analysis details</summary><p className="mt-2 leading-6">{steps.join(" · ")} · {request.analysis.run.model} · {(request.analysis.run.elapsedMs / 1000).toFixed(1)}s</p></details></div>
                <div className="md:col-span-2"><ProposedWorkPackages workPackages={review.workPackages} templates={company.config.tasks} editing={editing} disabled={!canEstimate || request.status === "frozen"} onEdit={() => setEditing(true)} onChange={(index, next) => setReview(current => current && ({ ...current, workPackages: current.workPackages.map((item, itemIndex) => itemIndex === index ? next : item), confirmed: false }))} onRemove={index => setReview(current => current && ({ ...current, workPackages: current.workPackages.filter((_, itemIndex) => itemIndex !== index), confirmed: false }))} onAdd={() => { const template = company.config.tasks[0]; if (!template) return; const item: ScopeWorkPackage = { id: crypto.randomUUID(), taskId: template.id, title: template.label, quantity: 1, complexity: "medium", owner: "company", acceptance: "", dependencies: "", rationale: "Added by reviewer.", evidence: "", evidenceSource: "Reviewer-added" }; setReview(current => current && ({ ...current, workPackages: [...current.workPackages, item], confirmed: false })); }} /></div>
                <div className="rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-semibold">Source-backed facts</h3>{request.analysis.facts.length ? <ul className="mt-3 space-y-3">{request.analysis.facts.map((fact, index) => <li key={index} className="border-t border-[var(--line)] pt-3"><p className="text-sm"><strong>{fact.key.replaceAll("_", " ")}:</strong> {fact.value} <span className="text-[10px] uppercase text-[var(--muted)]">{fact.status} · {fact.source}</span></p>{fact.evidence && <blockquote className="mt-1 border-l-2 border-neutral-400 pl-2 text-xs leading-5 text-[var(--muted)]">“{fact.evidence}”</blockquote>}<FindingReviewEditor value={findingReviews[`fact:${index}`]} disabled={!canEstimate || !editing || request.status === "frozen"} onChange={value => changeFindingReview(`fact:${index}`, value)} /></li>)}</ul> : <p className="mt-2 text-sm text-[var(--muted)]">No directly attributable facts were extracted.</p>}</div>
                <div className="rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-semibold">Product and capability fit</h3>{!company.knowledge.some(item => item.status === "approved") && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">No approved product knowledge is configured. Fit remains unknown.</p>}{request.analysis.productFindings.map((finding,index) => { const source=company.knowledge.find(item=>item.id===finding.sourceId); return <article key={index} className="mt-3 border-t border-[var(--line)] pt-3"><p className="text-sm"><strong>{finding.status}:</strong> {finding.explanation}{source && <span className="mt-1 block text-xs text-[var(--muted)]">Source: {source.url ? <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}{source.retrievedAt && <span className="ml-1">(retrieved {new Date(source.retrievedAt).toLocaleString()})</span>}</span>}{finding.evidence && <span className="mt-1 block text-xs text-[var(--muted)]">“{finding.evidence}”</span>}</p><FindingReviewEditor value={findingReviews[`product:${index}`]} disabled={!canEstimate || !editing || request.status === "frozen"} onChange={value => changeFindingReview(`product:${index}`, value)} /></article>; })}{request.analysis.capabilityFindings.map((finding,index) => <article key={`cap-${index}`} className="mt-3 border-t border-[var(--line)] pt-3"><p className="text-sm"><strong>{finding.capability} · {finding.status}:</strong> {finding.explanation}{finding.evidence && <span className="mt-1 block text-xs text-[var(--muted)]">“{finding.evidence}”</span>}</p><FindingReviewEditor value={findingReviews[`capability:${index}`]} disabled={!canEstimate || !editing || request.status === "frozen"} onChange={value => changeFindingReview(`capability:${index}`, value)} /></article>)}{!company.config.capabilities.length && <p className="mt-2 text-xs text-[var(--muted)]">Team capabilities have not been configured.</p>}</div>
                <div className="rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-semibold">AI assumptions and conflicts</h3><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Review each item and correct or reject it with a note when needed.</p>{request.analysis.conflicts.map((item,index)=><article key={`conflict-${index}`} className="mt-3 border-t border-[var(--line)] pt-3"><p className="text-sm"><strong>Conflict:</strong> {item}</p><FindingReviewEditor value={findingReviews[`conflict:${index}`]} disabled={!canEstimate || !editing || request.status === "frozen"} onChange={value => changeFindingReview(`conflict:${index}`, value)} /></article>)}{request.analysis.assumptions.map((item,index)=><article key={`assumption-${index}`} className="mt-3 border-t border-[var(--line)] pt-3"><p className="text-sm"><strong>Assumption:</strong> {item}</p><FindingReviewEditor value={findingReviews[`assumption:${index}`]} disabled={!canEstimate || !editing || request.status === "frozen"} onChange={value => changeFindingReview(`assumption:${index}`, value)} /></article>)}{!request.analysis.conflicts.length && !request.analysis.assumptions.length && <p className="mt-2 text-sm text-[var(--muted)]">No assumptions or conflicts were reported.</p>}</div>
                <details className="rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer text-sm font-semibold">Original request and sources</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--muted)]">{request.text || "No pasted message."}</pre>{request.attachments.length > 0 && <ul className="mt-3 space-y-2">{request.attachments.map(file=><li key={file.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs"><span className="min-w-0 break-all">{file.name} · {file.status.replaceAll("_", " ")} · {file.locators.join(", ") || "no page or sheet references"}{file.message ? ` · ${file.message}` : ""}</span><a className="shrink-0 underline" href={`/api/company-workspace?company=${encodeURIComponent(company.id)}&request=${encodeURIComponent(request.id)}&file=${encodeURIComponent(file.id)}`}>Download original</a></li>)}</ul>}</details>
              </div>}
            </Section>

            {request.analysis && <Section title="Human scope review" description="Correct deliverables, exclusions, acceptance, dependencies and task packages. Saving edits clears the previous scope confirmation.">
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <h3 className="text-sm font-semibold text-amber-950">Resolve analysis questions</h3>
                <p className="mt-1 text-xs leading-5 text-amber-950">Every AI question and any reviewer-added question needs an answer or a reason it does not apply before scope confirmation.</p>
                <div className="mt-3 space-y-3">{questionRows.map(({ key, question, value }) => <QuestionReviewEditor key={key} question={question} value={value} disabled={!canEstimate || !editing || request.status === "frozen"} onChange={next => changeQuestionResolution(key, next)} />)}{reviewerQuestionRows.map(({ key, question, value }) => <QuestionReviewEditor key={key} question={question} value={value} disabled={!canEstimate || !editing || request.status === "frozen"} onChange={next => changeQuestionResolution(key, next)} onRemove={() => setReview(current => { if (!current) return current; const remaining = { ...current.questionResolutions }; delete remaining[key]; return { ...current, questionResolutions: remaining, confirmed: false }; })} />)}</div>
                {!questionRows.length && !reviewerQuestionRows.length && <p className="mt-3 text-sm text-[var(--muted)]">No open analysis questions. Add any reviewer question that affects delivery readiness.</p>}
                {editing && <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><Field name="Add a reviewer question"><textarea className={input} rows={2} maxLength={500} value={reviewerQuestion} onChange={event => setReviewerQuestion(event.target.value)} placeholder="What still needs clarification before this scope is ready?" /></Field><button type="button" className={secondary} disabled={!canEstimate || !reviewerQuestion.trim()} onClick={() => { const key = `review:${crypto.randomUUID()}`; changeQuestionResolution(key, { question: reviewerQuestion.trim(), resolution: "" }); setReviewerQuestion(""); }}><Plus size={14} />Add question</button></div>}
              </div>
              <div className="mb-4 rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-semibold">Review each AI finding</h3><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Accept each finding or record a correction/rejection with an explanation. The original AI result and its evidence remain unchanged.</p></div>
              <div className="mb-4"><Field name="Reviewed work domain"><input className={input} disabled={!canEstimate || !editing || request.status === "frozen"} value={review.domain ?? ""} maxLength={100} onChange={event => setReview(current => current && ({ ...current, domain: event.target.value, confirmed: false }))}/></Field></div>
              <div className="mb-4 grid gap-4 md:grid-cols-2">{company.config.fields.filter(field => field.requestTypes.includes(review.requestType)).sort((a,b) => (a.priority ?? 5) - (b.priority ?? 5)).map(field => <Field key={field.key} name={`${field.label}${field.required ? " · required" : ""}`}><textarea className={input} rows={2} maxLength={2000} disabled={!canEstimate || !editing || request.status === "frozen"} value={review.fieldAnswers?.[field.key] ?? ""} onChange={event => setReview(current => current && ({ ...current, fieldAnswers: { ...current.fieldAnswers, [field.key]: event.target.value }, confirmed: false }))}/></Field>)}</div>
              {request.attachments.some(file => file.status !== "extracted" || file.truncated) && <label className="mb-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm"><input type="checkbox" disabled={!canEstimate || !editing || request.status === "frozen"} checked={review.sourceLimitationsAcknowledged ?? false} onChange={event => setReview(current => current && ({ ...current, sourceLimitationsAcknowledged: event.target.checked, confirmed: false }))}/>I reviewed the incomplete original sources and reconciled their limitations in this scope.</label>}
              <div className="grid gap-4 md:grid-cols-2"><Field name="Request type"><select className={input} disabled={!canEstimate || !editing || request.status === "frozen"} value={review.requestType} onChange={event => setReview(current => current && ({ ...current, requestType: event.target.value as ScopeReview["requestType"], confirmed: false }))}>{types.map(item => <option key={item} value={item}>{typeLabel[item]}</option>)}</select></Field><Field name="Product fit"><select className={input} disabled={!editing || request.status === "frozen"} value={review.productId} onChange={event => setReview(current => current && ({ ...current, productId: event.target.value, confirmed: false }))}><option value="">Unknown / not configured</option>{company.config.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
                <Field name="Deliverables"><textarea className={input} rows={4} required disabled={!editing || request.status === "frozen"} value={review.deliverables} onChange={event => setReview(current => current && ({ ...current, deliverables: event.target.value, confirmed: false }))} /></Field><Field name="Exclusions"><textarea className={input} rows={4} disabled={!editing || request.status === "frozen"} value={review.exclusions} onChange={event => setReview(current => current && ({ ...current, exclusions: event.target.value, confirmed: false }))} /></Field><Field name="Acceptance criteria · required"><textarea className={input} rows={4} required disabled={!editing || request.status === "frozen"} value={review.acceptance} onChange={event => setReview(current => current && ({ ...current, acceptance: event.target.value, confirmed: false }))} placeholder="Define what complete delivery will mean…" /></Field><Field name="Dependencies and owners · enter “None identified.” when there are none"><textarea className={input} rows={4} required disabled={!editing || request.status === "frozen"} value={review.dependencies} onChange={event => setReview(current => current && ({ ...current, dependencies: event.target.value, confirmed: false }))} placeholder="List prerequisites and owners, or enter “None identified.”" /></Field></div>
              <div className="mt-5 rounded-xl bg-[var(--paper)] p-4"><h3 className="text-sm font-semibold">Task breakdown above</h3><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Use the provisional package rows under the AI summary to review task templates, quantities, owners, acceptance criteria, prerequisites and supporting evidence.</p></div>
              {review.questions.length > 0 && <div className="mt-5 rounded-xl bg-amber-50 p-4"><h3 className="text-sm font-semibold text-amber-950">Open questions</h3><ul className="mt-2 list-inside list-disc text-sm text-amber-900">{review.questions.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}
              <div className="mt-5 flex flex-wrap items-center gap-2">{editing ? <><button className={button} disabled={!canEstimate || !!busy || !unsavedScope} onClick={() => void action({ action:"saveReview",requestId:request.id,expectedVersion:request.version,review },"Scope changes saved. Confirm them before estimating.")}><Check size={15} />Save scope changes</button><button className={secondary} onClick={() => { setReview(reviewForEditor(request, company.config.products)); setEditing(false); }}>Cancel</button></> : <button className={secondary} disabled={!canEstimate || request.status === "frozen" || !!busy} onClick={() => setEditing(true)}>Edit reviewed scope</button>}
                {!review.confirmed && request.status !== "frozen" && <button className={button} disabled={!canEstimate || !!busy || editing || reviewBlockers.length > 0} onClick={() => void action({ action:"confirmScope",requestId:request.id,expectedVersion:request.version,confirmed:true },"Scope confirmed. You can now calculate effort.")}><ShieldCheck size={15} />Confirm scope</button>}
                {review.confirmed && request.status !== "frozen" && <p className="inline-flex items-center gap-2 text-sm text-green-800"><CheckCircle2 size={16} />Scope confirmed by {review.confirmedBy}</p>}
              </div>
              {!review.confirmed && request.status !== "frozen" && reviewBlockers.length > 0 && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong>Resolve before confirming:</strong><ul className="mt-1 list-inside list-disc">{reviewBlockers.map(item=><li key={item}>{item}</li>)}</ul></div>}
            </Section>}

            {review.confirmed && request.status !== "frozen" && reviewBlockers.length > 0 && <Section title="Review required before estimating" description="This scope was confirmed before the current review checks. Reopen it to resolve every question and AI finding and make completion prerequisites explicit."><ul className="list-inside list-disc space-y-1 text-sm text-amber-950">{reviewBlockers.map(item=><li key={item}>{item}</li>)}</ul><button className={secondary + " mt-4"} disabled={!canEstimate || !!busy} onClick={() => setEditing(true)}>Reopen scope review</button></Section>}
            {review.confirmed && request.status !== "frozen" && reviewBlockers.length === 0 && <Section title="Explainable effort plan" description="Effort is calculated from configured task templates and reviewer-selected complexity. It is a planning range, not a calibrated prediction or calendar promise.">
              {!request.estimate ? <button className={button} disabled={!canEstimate || !!busy || !review.workPackages.length} onClick={() => void action({ action:"estimate",requestId:request.id,expectedVersion:request.version },"Effort range calculated from the current task configuration.")}><Sparkles size={15} />Calculate effort</button> : <><EstimateTable estimate={request.estimate} /><button className={button + " mt-4"} disabled={!canEstimate || !!busy} onClick={() => void action({ action:"freeze",requestId:request.id,expectedVersion:request.version },"Plan committed. Track delivery against the approved scope and effort.")}><ShieldCheck size={15} />Commit plan</button></>}
            </Section>}
            {request.baselines.length > 0 && <Section title="Commitment history" description="Each approved plan keeps the scope, effort estimate and company settings used when you committed.">{request.baselines.map(base=><details key={base.id} className="mb-3 rounded-xl bg-[var(--paper)] p-4"><summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><strong>Committed plan {base.revision}</strong><span className="text-xs text-estimator-muted">{new Date(base.createdAt).toLocaleString()}</span></summary><div className="mt-4"><EstimateTable estimate={base.estimate}/></div><details className="mt-4 text-xs text-estimator-muted"><summary className="cursor-pointer">Plan audit details</summary><p className="mt-2">Settings revision {base.configVersion}</p><p className="mt-2 break-all font-mono">SHA-256 {base.sha256}</p></details></details>)}</Section>}
            {request.status === "frozen" && <CommitmentTrackingPanel key={request.id} request={request} members={company.members} busy={!!busy} canEdit={canEstimate} onSave={action}/>}
            {request.status === "frozen" && <DeliveryPanel key={request.id} company={company} request={request} actorId={data!.actorId} busy={!!busy} action={body => action(body,"Delivery review updated.")}/>}
            <button className="text-xs font-medium text-red-800 underline" type="button" disabled={!canEstimate || request.status === "frozen" || !!busy} onClick={() => { if (window.confirm(`Delete “${request.title}” and its attached files? This cannot be undone.`)) void action({action:"deleteRequest",requestId:request.id,expectedVersion:request.version},"Request and attached files deleted."); }}>Delete request and files</button>
          </>}
          {!creatingRequest && !request && <Section title="Request unavailable" description="This request may have been removed or is no longer in this workspace."><button type="button" className={secondary} onClick={() => setRequestView("list")}><ArrowLeft size={15}/>Back to client briefs</button></Section>}
        </div>}
      </div></>}

      {panel === "settings" && <div className="space-y-5">
        <Section title="Workspace" description="Manage company context and the settings behind your delivery plans.">
          <div className="grid gap-5 sm:grid-cols-2"><Field name="Switch workspace"><select className={input} value={companyId} onChange={event => { setRequestId(""); setRequestView("list"); setCreatingRequest(false); setCompanyId(event.target.value); void load(event.target.value); }}>{data!.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="flex items-end"><button className={secondary} onClick={() => setCreatingCompany(true)}><Plus size={16}/>Create workspace</button></div></div>
          <dl className="mt-5 grid gap-4 border-t border-estimator-line pt-4 text-sm sm:grid-cols-3"><div><dt className="text-xs text-estimator-muted">AI analysis</dt><dd className="mt-1 font-medium">{data?.aiReady ? "Connected" : "Setup required"}</dd></div><div><dt className="text-xs text-estimator-muted">Your access</dt><dd className="mt-1 capitalize">{company.role}</dd></div><div><dt className="text-xs text-estimator-muted">Settings revision</dt><dd className="mt-1">{company.config.version} · retained with committed plans</dd></div></dl>
        </Section>
        <ConfigurationPanel key={`${company.id}:${company.version}`} company={company} busy={!!busy} save={config => action({ action:"saveConfiguration",expectedVersion:company.version,config },"Company settings saved.")} />
      </div>}
      {panel === "knowledge" && <KnowledgePanel key={`${company.id}:${company.version}`} company={company} busy={!!busy} action={body => action(body,"Company knowledge updated.")} />}
      {panel === "members" && <MembersPanel company={company} actorId={data!.actorId} publicDemo={publicDemo} busy={!!busy} action={body => action(body,"Organization access updated.")}/>}
      {panel === "connectors" && <ConnectorsPanel company={company} publicDemo={publicDemo} busy={!!busy} action={body => action(body,"Connector settings updated.")}/>}
      {panel === "audit" && <AuditPanel company={company} publicDemo={publicDemo}/>}
      {panel === "evaluation" && <EvaluationPanel company={company} publicDemo={publicDemo} onOpenRequests={() => { setPanel("requests"); setRequestView("list"); setCreatingRequest(false); }} onOpenRequest={id => { setPanel("requests"); setRequestId(id); setRequestView("detail"); setCreatingRequest(false); }}/>}
    </>}
    </div>
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-estimator-line py-5 text-xs leading-6 text-estimator-muted"><p className="max-w-2xl">Source-backed scope. Human review. Explainable effort.</p><span>The Estimator · {publicDemo ? "Shared public demo workspace" : "Private company workspace"}</span></footer>
  </main>;
}

function ProposedWorkPackages({ workPackages, templates, editing, disabled, onEdit, onChange, onRemove, onAdd }: { workPackages: ScopeWorkPackage[]; templates: CompanyConfig["tasks"]; editing: boolean; disabled: boolean; onEdit: () => void; onChange: (index: number, value: ScopeWorkPackage) => void; onRemove: (index: number) => void; onAdd: () => void }) {
  return <section className="rounded-2xl border border-estimator-line bg-white p-4 sm:p-5" aria-label="Proposed work packages">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-estimator-muted">Scope review · provisional</p><h3 className="mt-1 text-base font-semibold">Suggested tasks</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-estimator-muted">Review every task against the brief. AI suggestions do not include effort; the estimator calculates hours after scope approval.</p></div>{!editing && <button type="button" className={secondary} disabled={disabled} onClick={onEdit}>Edit task breakdown</button>}</div>
    {!workPackages.length && <p className="mt-4 rounded-xl bg-estimator-paper p-4 text-sm text-estimator-muted">No tasks were proposed. Add work packages during scope review.</p>}
    <div className="mt-4 space-y-3">{workPackages.map((item, index) => <article key={item.id} className="rounded-xl border border-estimator-line bg-estimator-canvas/40 p-3.5 sm:p-4">
      {editing ? <WorkPackageEditor item={item} index={index} templates={templates} disabled={disabled} onChange={value => onChange(index, value)} onRemove={() => onRemove(index)} /> : <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{item.title}</h4><span className="rounded-md bg-estimator-paper px-2 py-1 text-[11px] text-estimator-muted">{item.quantity} × {item.complexity}</span></div><p className="mt-1 text-xs text-estimator-muted">Task template: {templates.find(template => template.id === item.taskId)?.label ?? item.taskId} · owner: {item.owner}</p><p className="mt-3 text-sm leading-5"><strong className="font-medium">Completion:</strong> {item.acceptance || "Needs reviewer criteria"}</p><p className="mt-2 text-sm leading-5"><strong className="font-medium">Prerequisites:</strong> {item.dependencies || "Needs reviewer input"}</p></div><div className="rounded-lg bg-white p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-estimator-muted">AI rationale · verify during review</p><p className="mt-1 text-sm leading-5">{item.rationale || "No rationale returned. Confirm this task from the request."}</p>{item.evidence ? <blockquote className="mt-2 border-l-2 border-estimator-accent pl-2 text-xs leading-5 text-estimator-muted">“{item.evidence}”<span className="mt-1 block font-medium">{item.evidenceSource || "Verified client source"}</span></blockquote> : <p className="mt-2 text-xs text-amber-800">{item.evidenceSource || "No exact source quote verified; treat the proposal as an inference."}</p>}</div></div>}
      {editing && <div className="mt-3 rounded-lg bg-white p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-estimator-muted">AI rationale · verify during review</p><p className="mt-1 text-sm leading-5">{item.rationale || "No rationale returned; confirm this task from the request."}</p>{item.evidence ? <blockquote className="mt-2 border-l-2 border-estimator-accent pl-2 text-xs leading-5 text-estimator-muted">“{item.evidence}”<span className="mt-1 block font-medium">{item.evidenceSource || "Verified client source"}</span></blockquote> : <p className="mt-2 text-xs text-amber-800">No exact supporting quote was verified.</p>}</div>}
    </article>)}</div>
    {editing && <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" className={secondary} disabled={disabled || workPackages.length >= 20} onClick={onAdd}><Plus size={14} />Add work package</button><span className="text-xs text-estimator-muted">Save or cancel from the scope review below.</span></div>}
  </section>;
}

function CommitmentTrackingPanel({ request, members, busy, canEdit, onSave }: { request: ClientRequest; members: CompanyMember[]; busy: boolean; canEdit: boolean; onSave: (body: Record<string, unknown>, success: string) => Promise<WorkspaceResponse | undefined> }) {
  const baseline = request.baselines.at(-1);
  const packages = baseline?.review.workPackages ?? [];
  const [tasks, setTasks] = useState<RequestTaskTracking[]>(() => packages.map(item => request.taskTracking?.find(task => task.workPackageId === item.id) ?? { workPackageId: item.id, status: "not_started", assignee: "", plannedStart: "", plannedEnd: "", blocker: "", milestones: [] }));
  const [scopeChangeOpen, setScopeChangeOpen] = useState(false);
  const [scopeChange, setScopeChange] = useState({ description: "", reason: "", effortImpact: "" });
  const updateTask = (id: string, patch: Partial<RequestTaskTracking>) => setTasks(current => current.map(task => task.workPackageId === id ? { ...task, ...patch } : task));
  if (!baseline) return <Section title="Commit a plan to start tracking" description="Approve the scope and calculate effort before committing the plan."><p className="text-sm text-estimator-muted">Ask an estimator to review the scope and commit the plan first.</p></Section>;
  const estimate = baseline.estimate;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await onSave({ action: "saveTracking", requestId: request.id, expectedVersion: request.version, taskTracking: tasks, ...(scopeChangeOpen ? { scopeChange } : {}) }, "Commitment tracking saved against the frozen baseline.");
    if (saved && scopeChangeOpen) { setScopeChange({ description: "", reason: "", effortImpact: "" }); setScopeChangeOpen(false); }
  }
  return <Section title="Commitment & tracking" description="The approved baseline stays fixed. Update delivery progress here and record requested scope changes separately.">
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Committed on" value={new Date(baseline.createdAt).toLocaleDateString()} /><Metric label="Forecast range" value={`${estimate.adjustedLowHours ?? estimate.lowHours}–${estimate.adjustedHighHours ?? estimate.highHours} h`} /><Metric label="Central effort" value={`${estimate.adjustedHours ?? estimate.baseHours} h`} /><Metric label="Estimate basis" value={estimate.calibration === "training-history" ? "Reviewed delivery history" : "Company task templates"} /></div>
    <div className="mb-5 rounded-xl bg-estimator-paper p-3 text-xs leading-5 text-estimator-muted"><p>Set planned dates using your team’s availability, customer response times and vendor dependencies. Effort hours describe work, while dates describe your delivery schedule.</p><details className="mt-2"><summary className="cursor-pointer">Plan audit details</summary><p className="mt-2 break-all font-mono">SHA-256 {baseline.sha256}</p></details></div>
    {!canEdit && <p className="mb-4 rounded-lg bg-estimator-paper p-3 text-xs text-estimator-muted">Your role can view this commitment but cannot change tracking.</p>}
    <form className="space-y-4" onSubmit={submit}>
      {packages.map((item, index) => { const tracking = tasks.find(task => task.workPackageId === item.id)!; const taskEstimate = estimate.tasks[index]; return <article key={item.id} className="rounded-xl border border-estimator-line p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{item.title}</h3><p className="mt-1 text-xs text-estimator-muted">{taskEstimate?.lowHours ?? "—"}–{taskEstimate?.highHours ?? "—"} h · central {taskEstimate?.adjustedHours ?? taskEstimate?.baseHours ?? "—"} h · {item.owner} owned</p></div><span className="rounded-md bg-estimator-paper px-2 py-1 text-xs text-estimator-muted">Task {index + 1}</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field name="Task status"><select className={input} value={tracking.status} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { status: event.target.value as RequestTaskTracking["status"] })}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select></Field><Field name="Assigned member"><select className={input} value={tracking.assignee} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { assignee: event.target.value })}><option value="">Unassigned</option>{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName} · {member.role}</option>)}</select></Field><Field name="Planned start"><input className={input} type="date" value={tracking.plannedStart} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { plannedStart: event.target.value })} /></Field><Field name="Planned finish"><input className={input} type="date" value={tracking.plannedEnd} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { plannedEnd: event.target.value })} /></Field></div>
        {tracking.status === "blocked" && <Field name="Blocker · required"><textarea className={input} rows={2} required maxLength={1000} value={tracking.blocker} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { blocker: event.target.value })} placeholder="Describe what is blocking progress and who can resolve it." /></Field>}
        <div className="mt-4"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">Milestones</h4><button type="button" className="text-xs font-medium underline" disabled={busy || !canEdit || tracking.milestones.length >= 20} onClick={() => updateTask(item.id, { milestones: [...tracking.milestones, { id: crypto.randomUUID(), title: "", dueDate: "", status: "pending" }] })}>Add milestone</button></div>{!tracking.milestones.length && <p className="mt-2 text-xs text-estimator-muted">No milestones added.</p>}<div className="mt-2 space-y-2">{tracking.milestones.map(milestone => <div key={milestone.id} className="grid gap-2 rounded-lg bg-estimator-canvas/60 p-2 sm:grid-cols-[minmax(0,1fr)_160px_150px_auto] sm:items-end"><Field name="Milestone"><input className={input} required maxLength={160} value={milestone.title} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { milestones: tracking.milestones.map(value => value.id === milestone.id ? { ...value, title: event.target.value } : value) })} placeholder="e.g. Customer validation" /></Field><Field name="Due date"><input className={input} type="date" value={milestone.dueDate} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { milestones: tracking.milestones.map(value => value.id === milestone.id ? { ...value, dueDate: event.target.value } : value) })} /></Field><Field name="Status"><select className={input} value={milestone.status} disabled={busy || !canEdit} onChange={event => updateTask(item.id, { milestones: tracking.milestones.map(value => value.id === milestone.id ? { ...value, status: event.target.value as TaskMilestone["status"] } : value) })}><option value="pending">Pending</option><option value="complete">Complete</option></select></Field><button type="button" className="mb-2 text-xs text-red-800 underline" disabled={busy || !canEdit} onClick={() => updateTask(item.id, { milestones: tracking.milestones.filter(value => value.id !== milestone.id) })}>Remove</button></div>)}</div></div>
      </article>; })}
      <div className="flex flex-wrap items-center justify-between gap-3"><button className={button} disabled={busy || !canEdit || !packages.length}>Save task tracking</button><button type="button" className={secondary} disabled={busy || !canEdit} onClick={() => setScopeChangeOpen(value => !value)}>{scopeChangeOpen ? "Cancel scope change" : "Log a scope change"}</button></div>
      {scopeChangeOpen && <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4"><h3 className="font-semibold">Requested change after approval</h3><p className="mt-1 text-xs leading-5 text-estimator-muted">This entry is appended to the request. It does not rewrite the frozen scope or effort baseline.</p><div className="mt-3 grid gap-3 md:grid-cols-3"><Field name="Change requested"><textarea className={input} required rows={3} maxLength={1000} value={scopeChange.description} onChange={event => setScopeChange(current => ({ ...current, description: event.target.value }))} /></Field><Field name="Reason"><textarea className={input} required rows={3} maxLength={1000} value={scopeChange.reason} onChange={event => setScopeChange(current => ({ ...current, reason: event.target.value }))} /></Field><Field name="Effort impact or review needed"><textarea className={input} required rows={3} maxLength={500} value={scopeChange.effortImpact} onChange={event => setScopeChange(current => ({ ...current, effortImpact: event.target.value }))} placeholder="Estimate separately after approval" /></Field></div></div>}
    </form>
    {!!request.scopeChanges?.length && <div className="mt-6"><h3 className="text-sm font-semibold">Scope change log</h3><div className="mt-2 space-y-2">{request.scopeChanges.map(item => <article key={item.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{item.description}</strong><span className="text-xs text-estimator-muted">{item.status} · {new Date(item.createdAt).toLocaleString()} · {item.createdBy}</span></div><p className="mt-1 text-xs leading-5"><strong>Reason:</strong> {item.reason}</p><p className="mt-1 text-xs leading-5"><strong>Effort impact:</strong> {item.effortImpact}</p></article>)}</div></div>}
  </Section>;
}

function WorkPackageEditor({ item, index, templates, disabled, onChange, onRemove }: { item: ScopeWorkPackage; index: number; templates: CompanyConfig["tasks"]; disabled: boolean; onChange: (value: ScopeWorkPackage) => void; onRemove: () => void }) {
  return <div className="rounded-xl border border-[var(--line)] p-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_90px_110px]"><Field name={`Package ${index + 1}`}><input className={input} disabled={disabled} value={item.title} onChange={event=>onChange({...item,title:event.target.value})} /></Field><Field name="Task template"><select className={input} disabled={disabled} value={item.taskId} onChange={event=>{const template=templates.find(task=>task.id===event.target.value);onChange({...item,taskId:event.target.value,title:template?.label??item.title});}}>{templates.map(template=><option key={template.id} value={template.id}>{template.label}</option>)}</select></Field><Field name="Quantity"><input className={input} type="number" min="0.1" max="100" step="0.1" disabled={disabled} value={item.quantity} onChange={event=>onChange({...item,quantity:Number(event.target.value)})}/></Field><Field name="Complexity"><select className={input} disabled={disabled} value={item.complexity} onChange={event=>onChange({...item,complexity:event.target.value as ScopeWorkPackage["complexity"]})}><option>low</option><option>medium</option><option>high</option></select></Field></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Field name="Prerequisites and owner · state none if there are no prerequisites"><div className="flex flex-col gap-2 sm:flex-row"><select className={input} disabled={disabled} value={item.owner} onChange={event=>onChange({...item,owner:event.target.value as ScopeWorkPackage["owner"]})}><option value="company">Company</option><option value="customer">Customer</option><option value="vendor">Vendor</option></select><input className={input} required disabled={disabled} value={item.dependencies} onChange={event=>onChange({...item,dependencies:event.target.value})} placeholder="Prerequisite, owner, or ‘None identified.’" /></div></Field><Field name="Acceptance criteria · required"><input className={input} required disabled={disabled} value={item.acceptance} onChange={event=>onChange({...item,acceptance:event.target.value})} placeholder="How will this package be accepted?" /></Field></div>{!disabled&&<button className="mt-3 text-xs font-medium text-red-800 underline" type="button" onClick={onRemove}>Remove package</button>}</div>;
}

function EstimateTable({ estimate }: { estimate: NonNullable<ClientRequest["estimate"]> }) {
  const summary = estimate.calibrationSummary;
  const priorLow = estimate.lowHours;
  const priorHigh = estimate.highHours;
  const priorCentral = estimate.baseHours;
  const forecastLow = estimate.adjustedLowHours ?? priorLow;
  const forecastHigh = estimate.adjustedHighHours ?? priorHigh;
  const forecastCentral = estimate.adjustedHours ?? priorCentral;
  const minimumSamples = summary?.minimumSamplesPerTask;
  const exclusions = summary?.excluded;
  const excludedCounts = exclusions ? [
    ["Holdout", exclusions.holdout],
    ["Synthetic", exclusions.synthetic],
    ["Unreviewed or invalid", exclusions.unreviewedOrInvalid],
    ["Not comparable", exclusions.notComparable],
  ] as const : [];
  const adjustedTaskCount = estimate.tasks.filter(task => task.calibrationFactor !== undefined && task.calibrationFactor !== 1).length;
  return <>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Configured prior · range" value={`${priorLow}–${priorHigh} h`} />
      <Metric label="Configured prior · central" value={`${priorCentral} h`} />
      <Metric label="Adjusted forecast · range" value={`${forecastLow}–${forecastHigh} h`} />
      <Metric label="Adjusted forecast · central" value={`${forecastCentral} h`} />
    </div>
    <div className="overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full min-w-[860px] whitespace-normal text-left text-sm"><thead className="bg-[var(--paper)] text-xs text-[var(--muted)]"><tr><th className="p-3">Work package</th><th className="p-3">Quantity</th><th className="p-3">Configured prior</th><th className="p-3">Adjusted forecast</th><th className="p-3">Approved training</th></tr></thead><tbody>{estimate.tasks.map((task,index)=>{const samples=summary?.taskSamples[task.templateId];return <tr className="border-t border-[var(--line)]" key={`${task.templateId}-${index}`}><td className="min-w-60 p-3"><strong>{task.label}</strong><ul className="mt-1 text-xs leading-5 text-[var(--muted)]">{task.assumptions.map(item=><li key={item}>{item}</li>)}</ul></td><td className="p-3">{task.quantity} · {task.complexity}</td><td className="p-3">{task.lowHours}–{task.highHours} h<br/><span className="text-xs text-[var(--muted)]">central {task.baseHours} h</span></td><td className="p-3">{task.adjustedLowHours ?? task.lowHours}–{task.adjustedHighHours ?? task.highHours} h<br/><span className="text-xs text-[var(--muted)]">central {task.adjustedHours ?? task.baseHours} h · ×{(task.calibrationFactor ?? 1).toFixed(2)}</span></td><td className="p-3 text-xs">{samples === undefined ? "Sample count unavailable" : `${samples}${minimumSamples ? ` / ${minimumSamples}` : ""} examples`}</td></tr>;})}</tbody></table></div>
    <div className="mt-4 rounded-xl border border-[var(--line)] p-4 text-xs leading-5 text-[var(--muted)]">
      <p className="font-semibold text-[var(--ink)]">{estimate.calibration === "training-history" ? `Training-history adjustment · ${summary?.appliedTasks ?? adjustedTaskCount} task${(summary?.appliedTasks ?? adjustedTaskCount) === 1 ? "" : "s"} adjusted` : "Configured priors unchanged"}</p>
      {summary ? <>
        <p className="mt-1">Method: {summary.method} · domain: {summary.domain || "unspecified"} · request type: {summary.requestType}. Minimum {summary.minimumSamplesPerTask} independently approved training examples per task; adjustment capped at ×{summary.maximumAdjustmentFactor}.</p>
        {estimate.calibration === "uncalibrated" && <p className="mt-1">No task met the minimum sample threshold. The adjusted forecast is identical to the configured prior.</p>}
        <p className="mt-1">Excluded outcomes — {excludedCounts.map(([name,count])=>`${name}: ${count}`).join(" · ")}.</p>
        {summary.sourceBaselineIds.length > 0 && <details className="mt-2"><summary className="cursor-pointer font-medium text-[var(--ink)]">Contributing approved baseline records ({summary.sourceBaselineIds.length})</summary><ul className="mt-1 space-y-1 font-mono">{summary.sourceBaselineIds.map(id=><li key={id} className="break-all">{id}</li>)}</ul></details>}
      </> : <p className="mt-1">This saved estimate has no training-history provenance metadata. Its configured prior values remain visible above.</p>}
      <p className="mt-2">Calendar delivery dates also depend on staffing availability, client response time and vendor prerequisites. Those values are not estimated here.</p>
    </div>
  </>;
}
function Metric({ label: caption, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[var(--paper)] p-3"><p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{caption}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }

function ConfigurationPanel({ company, busy, save }: { company: Company; busy: boolean; save: (config: CompanyConfig) => Promise<WorkspaceResponse | undefined> }) {
  const [fields, setFields] = useState(company.config.fields);
  const [products, setProducts] = useState(company.config.products);
  const [tasks, setTasks] = useState(company.config.tasks);
  const [capabilities, setCapabilities] = useState(company.config.capabilities.join("\n"));
  const activeRequests = company.requests.filter(request => request.status !== "frozen");

  function createId(prefix: string, existing: string[]) {
    let id = `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    while (existing.includes(id)) id = `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    return id;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save({ ...company.config, fields, products, tasks, capabilities: capabilities.split("\n").map(item => item.trim()).filter(Boolean) });
  }

  return <Section title="Company workflow settings" description={`Configuration v${company.config.version}. Saved changes create a new version; existing requests and frozen estimates retain their original snapshot.`}>
    {company.role !== "admin" && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">Only company admins can change these settings. You can still review the current setup.</p>}
    <form className="space-y-5" onSubmit={submit}>
      <fieldset disabled={busy || company.role !== "admin"} className="space-y-5 disabled:opacity-75">
        <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold tracking-tight">Request fields</h3><p className="mt-1 text-sm leading-5 text-estimator-muted">Choose which details reviewers capture for each kind of request.</p></div><span className="rounded-lg bg-white px-2.5 py-1 text-xs text-estimator-muted">{fields.length} fields</span></div>
          <div className="mt-4 space-y-3">
            {fields.map((field, index) => {
              const inUse = activeRequests.filter(request => Object.hasOwn(request.review.fieldAnswers ?? {}, field.key)).length;
              return <article key={field.key} className="rounded-xl border border-estimator-line bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                <Field name="Field label"><input className={input} maxLength={100} required value={field.label} onChange={event => setFields(current => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} placeholder="e.g. Number of investors"/></Field>
                <Field name="Priority · 1–10"><input className={input} type="number" min="1" max="10" step="1" value={field.priority ?? 5} onChange={event => setFields(current => current.map((item, i) => i === index ? { ...item, priority: Number(event.target.value) } : item))}/></Field>
              </div>
              <p className="mt-3 text-xs font-medium text-estimator-muted">Use this field for</p>
              <div className="mt-2 flex flex-wrap gap-2">{types.map(type => <label key={type} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-estimator-line px-3 text-xs text-estimator-ink"><input type="checkbox" checked={field.requestTypes.includes(type)} onChange={event => setFields(current => current.map((item, i) => i === index ? { ...item, requestTypes: event.target.checked ? [...item.requestTypes, type] : item.requestTypes.filter(value => value !== type) } : item))}/>{typeLabel[type]}</label>)}</div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={field.required} onChange={event => setFields(current => current.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))}/>Required before estimate</label><div className="flex items-center gap-2">{inUse > 0 && <span className="text-xs text-estimator-muted">Used in {inUse} open {inUse === 1 ? "request" : "requests"}</span>}<button className="min-h-10 px-2 text-sm font-medium text-red-800 underline disabled:text-estimator-muted disabled:no-underline" type="button" disabled={inUse > 0} onClick={() => setFields(current => current.filter((_, i) => i !== index))}>Remove field</button></div></div>
            </article>;
            })}
            {!fields.length && <p className="rounded-xl bg-white p-4 text-sm text-estimator-muted">No additional request fields are configured yet.</p>}
          </div>
          <button className={secondary + " mt-3"} type="button" onClick={() => { const key = createId("field", fields.map(item => item.key)); setFields(current => [...current, { key, label: "", requestTypes: [...types], required: false, priority: 5 }]); }}><Plus size={15}/>Add request field</button>
        </section>

        <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold tracking-tight">Products and services</h3><p className="mt-1 text-sm leading-5 text-estimator-muted">Describe only the offerings your team can support. AI findings must still cite approved knowledge.</p></div><span className="rounded-lg bg-white px-2.5 py-1 text-xs text-estimator-muted">{products.length} products</span></div>
          <div className="mt-4 space-y-3">{products.map((product, index) => {
            const inUse = activeRequests.filter(request => request.review.productId === product.id).length;
            return <article key={product.id} className="grid gap-3 rounded-xl border border-estimator-line bg-white p-4 sm:grid-cols-2">
            <Field name="Product name"><input className={input} maxLength={100} required value={product.name} onChange={event => setProducts(current => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} placeholder="e.g. Investor onboarding"/></Field>
            <Field name="Short description"><textarea className={input} rows={2} maxLength={1000} value={product.description} onChange={event => setProducts(current => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} placeholder="What does this product or service cover?"/></Field>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2"><span className="font-mono text-[11px] text-estimator-muted">ID · {product.id}</span><div className="flex items-center gap-2">{inUse > 0 && <span className="text-xs text-estimator-muted">Used in {inUse} open {inUse === 1 ? "request" : "requests"}</span>}<button className="min-h-10 px-2 text-sm font-medium text-red-800 underline disabled:text-estimator-muted disabled:no-underline" type="button" disabled={inUse > 0} onClick={() => setProducts(current => current.filter((_, i) => i !== index))}>Remove product</button></div></div>
          </article>;
          })}</div>
          <button className={secondary + " mt-3"} type="button" onClick={() => { const id = createId("product", products.map(item => item.id)); setProducts(current => [...current, { id, name: "", description: "" }]); }}><Plus size={15}/>Add product</button>
        </section>

        <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold tracking-tight">Task templates and effort ranges</h3><p className="mt-1 text-sm leading-5 text-estimator-muted">Set the prior hours per unit and the low/high planning multipliers. Approved training history can adjust eligible task estimates.</p></div><span className="rounded-lg bg-white px-2.5 py-1 text-xs text-estimator-muted">{tasks.length} templates</span></div>
          <div className="mt-4 space-y-3">{tasks.map((task, index) => {
            const inUse = activeRequests.filter(request => request.review.workPackages.some(item => item.taskId === task.id)).length;
            return <article key={task.id} className="rounded-xl border border-estimator-line bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2"><Field name="Task name"><input className={input} maxLength={100} required value={task.label} onChange={event => setTasks(current => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))}/></Field><p className="self-end pb-2 font-mono text-[11px] text-estimator-muted">ID · {task.id}</p></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3"><Field name="Base hours per unit"><input className={input} type="number" min="0.1" max="10000" step="0.1" required value={task.baseHours} onChange={event => setTasks(current => current.map((item, i) => i === index ? { ...item, baseHours: Number(event.target.value) } : item))}/></Field><Field name="Low multiplier · 0.1–1"><input className={input} type="number" min="0.1" max="1" step="0.05" required value={task.lowFactor} onChange={event => setTasks(current => current.map((item, i) => i === index ? { ...item, lowFactor: Number(event.target.value) } : item))}/></Field><Field name="High multiplier · 1–5"><input className={input} type="number" min="1" max="5" step="0.05" required value={task.highFactor} onChange={event => setTasks(current => current.map((item, i) => i === index ? { ...item, highFactor: Number(event.target.value) } : item))}/></Field></div>
            <div className="mt-2 flex flex-wrap items-center gap-2">{inUse > 0 && <span className="text-xs text-estimator-muted">Used in {inUse} open {inUse === 1 ? "request" : "requests"}</span>}<button className="min-h-10 px-2 text-sm font-medium text-red-800 underline disabled:text-estimator-muted disabled:no-underline" type="button" disabled={tasks.length <= 1 || inUse > 0} onClick={() => setTasks(current => current.filter((_, i) => i !== index))}>Remove template</button></div>
          </article>;
          })}</div>
          <button className={secondary + " mt-3"} type="button" onClick={() => { const id = createId("task", tasks.map(item => item.id)); setTasks(current => [...current, { id, label: "", baseHours: 1, lowFactor: 0.75, highFactor: 1.5 }]); }}><Plus size={15}/>Add task template</button>
        </section>

        <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
          <h3 className="text-base font-semibold tracking-tight">Team capabilities</h3><p className="mt-1 text-sm leading-5 text-estimator-muted">List skills or systems the team is prepared to support. One item per line.</p>
          <Field name="Configured capabilities"><textarea className={input} rows={5} maxLength={8000} value={capabilities} onChange={event => setCapabilities(event.target.value)} placeholder={'Salesforce\nInvestor data migration\nREST API integrations'}/></Field>
          <p className="mt-2 text-xs leading-5 text-estimator-muted">An unlisted capability stays unknown until an admin adds it and approved company knowledge supports it.</p>
        </section>

        <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={busy || tasks.length === 0}><Settings2 size={16}/>{busy ? "Saving settings…" : "Save settings"}</button><span className="text-xs text-estimator-muted">Your changes create configuration version {company.config.version + 1}.</span></div>
      </fieldset>
    </form>
  </Section>;
}

function KnowledgePanel({ company, busy, action }: { company: Company; busy: boolean; action: (body: Record<string, unknown>) => Promise<WorkspaceResponse | undefined> }) {
  const [title, setTitle] = useState(""); const [url, setUrl] = useState(""); const [text, setText] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const result=await action({action:"addKnowledge",expectedVersion:company.version,title,url,text}); if(result){setTitle("");setUrl("");setText("");} }
  return <div className="grid gap-5 lg:grid-cols-2"><Section title="Add approved company knowledge" description="Paste an official or administrator-authorized source excerpt. New entries remain drafts until an administrator approves them."><form className="space-y-3" onSubmit={submit}><fieldset className="space-y-4" disabled={busy || company.role !== "admin"}><Field name="Source title"><input className={input} minLength={2} maxLength={200} required value={title} onChange={event=>setTitle(event.target.value)}/></Field><Field name="Source URL (optional for internal material)"><input className={input} type="url" maxLength={2000} value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://docs.example.com/..."/></Field><Field name="Source text"><textarea className={input} rows={8} minLength={30} maxLength={100000} required value={text} onChange={event=>setText(event.target.value)} placeholder="Paste the passage or content to make available to AI analysis…"/></Field><p className="rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">Only approved knowledge is supplied to analysis. Each version retains its source title, URL, approval time and SHA-256 digest.</p><button className={button} disabled={busy}>Add draft source</button></fieldset></form></Section><Section title="Approved knowledge library" description="Only active approved versions can support product-fit findings.">{company.knowledge.length? <div className="space-y-3">{company.knowledge.map(source=><article key={source.id} className="rounded-xl border border-[var(--line)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{source.title}</strong><span className={`rounded-full px-2 py-1 text-[10px] uppercase ${source.status==="approved"?"bg-green-50 text-green-800":source.status==="draft"?"bg-amber-50 text-amber-900":"bg-neutral-100 text-neutral-600"}`}>{source.status}</span></div>{source.url&&<a className="mt-1 block break-all text-xs underline" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>}<p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{source.text}</p><p className="mt-2 break-all font-mono text-[10px] text-[var(--muted)]">SHA-256 {source.sha256}</p>{source.approvedAt&&<p className="mt-1 text-[10px] text-[var(--muted)]">Approved {new Date(source.approvedAt).toLocaleString()} by {source.approvedBy}</p>}<div className="mt-3 flex gap-2">{company.role==="admin"&&source.status==="draft"&&<button className={secondary} disabled={busy} onClick={()=>void action({action:"approveKnowledge",expectedVersion:company.version,knowledgeId:source.id})}>Approve source</button>}{company.role==="admin"&&source.status==="approved"&&<button className={secondary} disabled={busy} onClick={()=>void action({action:"retireKnowledge",expectedVersion:company.version,knowledgeId:source.id})}>Retire version</button>}</div></article>)}</div>:<p className="text-sm text-[var(--muted)]">No knowledge sources yet. Add a draft and approve it before use.</p>}</Section></div>;
}
