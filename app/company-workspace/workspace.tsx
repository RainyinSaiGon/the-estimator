"use client";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Layers3,
  Loader2,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { extractClientFile } from "../../lib/browser-document-extraction";
import type {
  ScopeReview,
  ScopeWorkPackage,
  WorkspaceResponse,
} from "../../lib/client-workflow-types";
import { AnalysisFindings } from "./components/analysis-findings";
import { CommitmentTrackingPanel } from "./components/commitment-tracking";
import { ConfigurationPanel } from "./components/company-configuration";
import { KnowledgePanel } from "./components/company-knowledge";
import { EstimateTable } from "./components/effort-plan";
import { RequestInbox } from "./components/request-inbox";
import { RequestIntakeForm, type UploadItem } from "./components/request-intake";
import { Progress } from "./components/request-progress";
import { ScopeReviewPanel } from "./components/scope-review";
import { ProposedWorkPackages } from "./components/work-packages";
import {
  AuditPanel,
  ConnectorsPanel,
  DeliveryPanel,
  EvaluationPanel,
  MembersPanel,
} from "./governance";
import { reviewForEditor, typeLabel } from "./request-presentation";
import { getScopeReviewState } from "./review-state";
import { button, card, Field, input, secondary, Section } from "./ui";
import { api } from "./workspace-api";
import { panels, settingsGroups, type Panel } from "./workspace-navigation";

export default function CompanyWorkspace({
  userName,
  guest = false,
  publicDemo = false,
}: {
  userName: string;
  guest?: boolean;
  publicDemo?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [panel, setPanel] = useState<Panel>("requests");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const [companyId, setCompanyId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [requestView, setRequestView] = useState<"list" | "detail">("list");
  const requestFocus = useRef<{ id: string; section: string } | null>(null);
  const [requestOpenSequence, setRequestOpenSequence] = useState(0);
  const [requestQuery, setRequestQuery] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const startRequestAfterCompany = useRef(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1",
  );
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
  const request = company?.requests.find((item) => item.id === requestId) ?? null;
  const sampleRequest = publicDemo
    ? company?.requests.find((item) => item.cohort === "synthetic" && item.analysis)
    : undefined;

  const [review, setReview] = useState<ScopeReview | null>(null);
  const [editorReady, setEditorReady] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    async (id?: string) => {
      if (guest) return;
      setBusy("load");
      setError("");
      try {
        const next = await api(undefined, id || companyId || undefined);
        setData(next);
        const nextCompany = next.company;
        setCompanyId(nextCompany?.id ?? "");
        setRequestId((current) =>
          nextCompany?.requests.some((item) => item.id === current) ? current : "",
        );
        if (nextCompany && startRequestAfterCompany.current) {
          setPanel("requests");
          setCreatingCompany(false);
          setCreatingRequest(true);
          setRequestId("");
          setRequestView("detail");
          startRequestAfterCompany.current = false;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open company workspace.");
      } finally {
        setBusy("");
      }
    },
    [companyId, guest],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!settingsOpen) return;
    const items = [
      ...(settingsMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    if (document.activeElement === settingsTriggerRef.current) items[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !settingsMenuRef.current?.contains(event.target))
        setSettingsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        settingsTriggerRef.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) return;
      const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : activeIndex < 0
              ? event.key === "ArrowUp"
                ? items.length - 1
                : 0
              : event.key === "ArrowDown"
                ? (activeIndex + 1) % items.length
                : (activeIndex - 1 + items.length) % items.length;
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
    const focus = requestFocus.current;
    const timer = window.setTimeout(() => {
      if (!request) {
        setReview(null);
        setEditorReady("");
        setReviewerQuestion("");
        return;
      }
      setReview(reviewForEditor(request, company?.config.products ?? []));
      setEditing(
        focus?.id === request.id &&
          focus.section === "scope" &&
          canEstimate &&
          request.status !== "frozen",
      );
      setEditorReady(`${request.id}:${requestOpenSequence}`);
      setReviewerQuestion("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [request, company?.config.products, requestOpenSequence, canEstimate]);

  useEffect(() => {
    const target = requestFocus.current;
    if (
      !target ||
      target.id !== request?.id ||
      editorReady !== `${request.id}:${requestOpenSequence}` ||
      panel !== "requests" ||
      requestView !== "detail" ||
      !review
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById(`request-${target.section}`);
      if (section) {
        section.focus({ preventScroll: true });
        section.scrollIntoView({ block: "start" });
        requestFocus.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panel, requestView, request, review, requestOpenSequence, editorReady]);

  function openRequest(id: string, action?: string) {
    requestFocus.current = {
      id,
      section:
        action === "Review scope"
          ? "scope"
          : action === "Calculate effort" || action === "Commit plan"
            ? "effort"
            : action === "Open a committed plan"
              ? "tracking"
              : "analysis",
    };
    setRequestOpenSequence((current) => current + 1);
    setPanel("requests");
    setRequestId(id);
    setRequestView("detail");
    setCreatingRequest(false);
  }

  async function run(name: string, work: () => Promise<WorkspaceResponse>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const next = await work();
      setData(next);
      const nextCompany = next.company;
      if (nextCompany) {
        setCompanyId(nextCompany.id);
        setRequestId((current) =>
          nextCompany.requests.some((item) => item.id === current) ? current : "",
        );
        if (startRequestAfterCompany.current) {
          setPanel("requests");
          setCreatingCompany(false);
          setCreatingRequest(true);
          setRequestId("");
          setRequestView("detail");
          startRequestAfterCompany.current = false;
        }
      }
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workspace request failed.");
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    const next = await run("company", () => api({ action: "createCompany", name: companyName }));
    if (next?.company) {
      setCompanyName("");
      setCreatingCompany(false);
      setPanel("requests");
      setRequestView("list");
      setNotice(
        "Company workspace created. Add your request templates and approved knowledge when ready.",
      );
    }
  }
  async function createRequest(event: FormEvent) {
    event.preventDefault();
    if (!company) return;
    if (processingUploads || uploads.some((item) => item.error || !item.result)) return;
    const body: Record<string, unknown> = {
      action: "createRequest",
      companyId: company.id,
      title,
      text,
      cohort,
      attachments: uploads.map((item) => item.result),
    };
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
      setTitle("");
      setText("");
      setUploads([]);
      setCreatingRequest(false);
      setNotice(
        created?.analysisError
          ? "Request saved. AI analysis did not complete; retry it from the request."
          : "Request analyzed. Review the evidence and scope before estimating.",
      );
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
    if (selected.length + uploads.length > 10) {
      setError("Choose no more than 10 request files.");
      return;
    }
    setError("");
    setProcessingUploads(true);
    const extracted = await Promise.all(
      selected.map(async (file) => {
        try {
          return { file, result: await extractClientFile(file) } satisfies UploadItem;
        } catch (cause) {
          return {
            file,
            error: cause instanceof Error ? cause.message : "Could not read this file.",
          } satisfies UploadItem;
        }
      }),
    );
    setUploads((current) => [...current, ...extracted]);
    setProcessingUploads(false);
  }

  const steps = request?.analysis?.run.steps ?? [];
  const unsavedScope =
    !!request && !!review && JSON.stringify(review) !== JSON.stringify(request.review);
  const reviewState = getScopeReviewState(request, review, company);
  const { findingReviews, reviewBlockers } = reviewState;

  function changeQuestionResolution(
    key: string,
    value: NonNullable<ScopeReview["questionResolutions"]>[string],
  ) {
    setReview(
      (current) =>
        current && {
          ...current,
          questionResolutions: { ...current.questionResolutions, [key]: value },
          confirmed: false,
        },
    );
  }
  function changeFindingReview(
    key: string,
    value: NonNullable<ScopeReview["findingReviews"]>[string],
  ) {
    setReview(
      (current) =>
        current && {
          ...current,
          findingReviews: { ...current.findingReviews, [key]: value },
          confirmed: false,
        },
    );
  }

  if (guest)
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-5 py-12 font-sans sm:px-8">
        <section className={card + " w-full text-center !p-8 sm:!p-12"}>
          <Sparkles className="mx-auto mb-4" />
          <p className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">
            Company request workflow
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight">
            Sign in to open your workspace
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--muted)]">
            Requests, evidence and frozen estimates are available only to your signed-in workspace.
          </p>
          <a
            className={button + " mt-6"}
            href="/signin-with-chatgpt?return_to=%2Fcompany-workspace"
            onClick={(event) => {
              event.preventDefault();
              const newRequest =
                startRequestAfterCompany.current ||
                new URLSearchParams(window.location.search).get("new") === "1";
              const returnTo = newRequest ? "/company-workspace?new=1" : "/company-workspace";
              router.push(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`);
            }}
          >
            Sign in with ChatGPT
          </a>
        </section>
      </main>
    );

  return (
    <main
      id="company-main"
      className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-6 font-sans sm:px-8 lg:px-10"
    >
      <a
        className="sr-only focus:not-sr-only focus:mb-4 focus:rounded-full focus:bg-estimator-ink focus:px-4 focus:py-3 focus:text-white"
        href="#company-content"
      >
        Skip to workspace content
      </a>
      <header className="mb-6 flex items-center justify-between gap-4 border-b border-estimator-line pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-estimator-ink text-white"
          >
            <Layers3 size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-estimator-muted">
              The Estimator
            </p>
            <h1 className="mt-1 break-words text-lg font-semibold leading-tight tracking-tight sm:text-xl">
              {company?.name ?? "AI request workspace"}
            </h1>
          </div>
        </div>
        {!publicDemo && (
          <p className="max-w-40 truncate text-xs text-estimator-muted sm:max-w-none">{userName}</p>
        )}
      </header>
      <div
        id="company-content"
        tabIndex={-1}
        className={`min-w-0 flex-1 ${!company ? "flex flex-col" : ""}`}
      >
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mb-5 rounded-xl bg-green-50 p-4 text-sm text-green-900">
            {notice}
          </div>
        )}
        {creatingCompany && (
          <div className="grid flex-1 place-items-center py-8">
            <form onSubmit={createCompany} className={card + " w-full max-w-xl"}>
              <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-estimator-signal text-estimator-signal-ink">
                <Layers3 size={23} />
              </span>
              <p className="text-[10px] uppercase tracking-[.18em] text-estimator-muted">
                {publicDemo ? "Shared demo workspace" : "A home for your requests"}
              </p>
              <h2 className="mt-2 text-2xl font-medium tracking-tight">
                {publicDemo ? "Create a fictional demo company" : "Create a company workspace"}
              </h2>
              <p className="mb-6 mt-3 text-sm leading-6 text-estimator-muted">
                {publicDemo
                  ? "Configure a fictional demo company."
                  : "Start with generic request fields and planning templates."}{" "}
                Add your products, approved knowledge and team when you’re ready.
              </p>
              <Field name="Company name">
                <input
                  className={input}
                  placeholder="e.g. Acme Consulting"
                  value={companyName}
                  minLength={2}
                  maxLength={120}
                  required
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </Field>
              <div className="mt-6 flex flex-wrap gap-2">
                <button className={button} disabled={!!busy}>
                  Create workspace
                  <ArrowLeft className="rotate-180" size={15} />
                </button>
                <button
                  type="button"
                  className={secondary}
                  onClick={() => setCreatingCompany(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
        {data && !company && !creatingCompany && (
          <div className="grid flex-1 place-items-center py-12">
            <section className={card + " w-full max-w-2xl text-center !p-8 sm:!p-12"}>
              <span className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-estimator-signal text-estimator-signal-ink">
                <Layers3 size={27} />
              </span>
              <p className="text-[10px] font-medium uppercase tracking-[.2em] text-estimator-muted">
                {publicDemo ? "Shared public demo" : "Your private workspace"}
              </p>
              <h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">
                Good estimates start with context.
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-estimator-muted">
                Bring your company’s knowledge, request templates and delivery experience together.
                Then turn each client brief into a scope you can review.
              </p>
              <button className={button + " mt-7"} onClick={() => setCreatingCompany(true)}>
                <Plus size={16} />
                Create company workspace
              </button>
              <p className="mt-4 text-xs text-estimator-muted">
                {publicDemo
                  ? "Changes are visible to everyone using this demo."
                  : "Private to your team. Built around your business."}
              </p>
            </section>
          </div>
        )}
        {!data && !error && (
          <div className="grid flex-1 place-items-center py-20">
            <p role="status" className="flex items-center gap-3 text-sm text-estimator-muted">
              <Loader2 size={18} className="animate-spin" />
              Opening your company workspace…
            </p>
          </div>
        )}

        {company && !creatingCompany && (
          <>
            <nav
              aria-label="Company sections"
              className="mb-5 flex items-center gap-2 border-b border-estimator-line pb-3"
            >
              <div className="inline-flex items-center gap-1 rounded-xl bg-estimator-paper p-1">
                {panels
                  .filter(({ id }) => id === "requests" || id === "evaluation")
                  .map(({ id, title, icon: Icon }) => {
                    const className = `inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition sm:px-3 ${panel === id ? "bg-estimator-ink text-white shadow-sm" : "text-estimator-muted hover:bg-white hover:text-estimator-ink"}`;
                    return (
                      <button
                        key={id}
                        aria-current={panel === id ? "page" : undefined}
                        className={className}
                        onClick={() => {
                          setPanel(id);
                          setSettingsOpen(false);
                          setNotice("");
                          setError("");
                        }}
                      >
                        <Icon size={16} className="hidden sm:block" />
                        {title}
                      </button>
                    );
                  })}
              </div>
              <div ref={settingsMenuRef} className="relative ml-auto">
                <button
                  ref={settingsTriggerRef}
                  type="button"
                  aria-label="Workspace settings"
                  aria-haspopup="menu"
                  aria-expanded={settingsOpen}
                  aria-controls="company-settings-menu"
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition ${panels.some(({ id }) => id !== "requests" && id !== "evaluation" && id === panel) ? "bg-estimator-paper text-estimator-ink" : "text-estimator-muted hover:bg-estimator-paper hover:text-estimator-ink"}`}
                  onClick={() => setSettingsOpen((value) => !value)}
                >
                  <Settings2 size={16} />
                  <span className="hidden sm:inline">Workspace settings</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {settingsOpen && (
                  <div
                    id="company-settings-menu"
                    role="menu"
                    aria-label="Workspace settings"
                    className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-estimator-line bg-white p-2 shadow-xl"
                  >
                    {settingsGroups.map((group) => (
                      <section
                        key={group.title}
                        role="group"
                        aria-label={group.title}
                        className="py-1"
                      >
                        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[.16em] text-estimator-muted">
                          {group.title}
                        </p>
                        {panels
                          .filter(({ id }) => group.ids.some((groupId) => groupId === id))
                          .map(({ id, title, icon: Icon }) => (
                            <button
                              key={id}
                              type="button"
                              role="menuitem"
                              aria-current={panel === id ? "page" : undefined}
                              className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition ${panel === id ? "bg-estimator-ink text-white" : "text-estimator-ink hover:bg-estimator-paper"}`}
                              onClick={() => {
                                setPanel(id);
                                setSettingsOpen(false);
                                setNotice("");
                                setError("");
                                settingsTriggerRef.current?.focus();
                              }}
                            >
                              <Icon size={16} />
                              {title}
                              {panel === id && <Check size={14} className="ml-auto" />}
                            </button>
                          ))}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </nav>
            {busy && (
              <p className="mb-4 flex items-center gap-2 text-sm text-[var(--muted)]" role="status">
                <Loader2 size={15} className="animate-spin" />
                {busy === "receive"
                  ? "Analyzing request with AI…"
                  : busy === "analyze"
                    ? "Retrying AI analysis…"
                    : "Saving changes…"}
              </p>
            )}

            {panel === "requests" && (
              <>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {requestView === "list" ? (
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-semibold tracking-tight">Client briefs</h2>
                        <span className="rounded-lg bg-estimator-paper px-2 py-1 text-xs font-medium text-estimator-muted">
                          {company.requests.length}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-estimator-muted">
                        AI turns each brief into facts, questions and suggested tasks. Review the
                        scope, calculate effort, then commit and track delivery.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        className={secondary + " shrink-0 self-start"}
                        onClick={() => {
                          setRequestView("list");
                          setCreatingRequest(false);
                          setError("");
                          setNotice("");
                        }}
                      >
                        <ArrowLeft size={15} />
                        Back to client briefs
                      </button>
                      <p className="mt-2 text-xs uppercase tracking-[.16em] text-estimator-muted">
                        {creatingRequest ? "Add brief" : "Client brief"}
                      </p>
                    </div>
                  )}
                  {requestView === "list" && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {sampleRequest && (
                        <button
                          className={secondary}
                          onClick={() => {
                            setCreatingRequest(false);
                            setRequestId(sampleRequest.id);
                            setRequestView("detail");
                          }}
                        >
                          Open sample brief
                        </button>
                      )}
                      <button
                        disabled={!canEstimate}
                        className={button}
                        onClick={() => {
                          setCreatingRequest(true);
                          setRequestId("");
                          setRequestView("detail");
                        }}
                      >
                        <Plus size={16} />
                        Add brief
                      </button>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  {requestView === "list" && (
                    <RequestInbox
                      requests={company.requests}
                      query={requestQuery}
                      publicDemo={publicDemo}
                      onQueryChange={setRequestQuery}
                      onOpenRequest={(id) => {
                        setCreatingRequest(false);
                        setRequestId(id);
                        setRequestView("detail");
                      }}
                    />
                  )}
                  {requestView === "detail" && (
                    <div className="min-w-0 space-y-5">
                      {creatingRequest && (
                        <RequestIntakeForm
                          publicDemo={publicDemo}
                          title={title}
                          text={text}
                          cohort={cohort}
                          uploads={uploads}
                          processingUploads={processingUploads}
                          busy={!!busy}
                          aiReady={!!data?.aiReady}
                          onSubmit={createRequest}
                          onTitleChange={setTitle}
                          onTextChange={setText}
                          onCohortChange={setCohort}
                          onChooseFiles={chooseFiles}
                          onRemoveUpload={(index) =>
                            setUploads((current) => current.filter((_, i) => i !== index))
                          }
                        />
                      )}
                      {request && review && (
                        <>
                          <Section
                            id="request-analysis"
                            title={request.title}
                            description={`${typeLabel[request.analysis?.requestType ?? request.review.requestType] ?? "Client request"} · received ${new Date(request.createdAt).toLocaleString()}`}
                          >
                            <Progress
                              request={request}
                              needsReview={
                                reviewBlockers.length > 0 || !review.confirmed || editing
                              }
                            />
                            {request.analysisError && (
                              <div
                                role="alert"
                                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                              >
                                <p>{request.analysisError}</p>
                                <button
                                  className="mt-2 font-medium underline"
                                  disabled={!!busy}
                                  onClick={() =>
                                    void action(
                                      {
                                        action: "analyze",
                                        requestId: request.id,
                                        expectedVersion: request.version,
                                      },
                                      "AI analysis completed. Review its findings.",
                                    )
                                  }
                                >
                                  Retry AI analysis
                                </button>
                              </div>
                            )}
                            {request.analysis && (
                              <div className="mt-5 grid gap-4 md:grid-cols-2">
                                <div className="rounded-xl bg-[var(--paper)] p-4 md:col-span-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                    AI draft · review before committing
                                  </p>
                                  <p className="mt-2 text-sm leading-6">
                                    {request.analysis.summary}
                                  </p>
                                  <details className="mt-3 text-xs text-estimator-muted">
                                    <summary className="cursor-pointer">Analysis details</summary>
                                    <p className="mt-2 leading-6">
                                      {steps.join(" · ")} · {request.analysis.run.model} ·{" "}
                                      {(request.analysis.run.elapsedMs / 1000).toFixed(1)}s
                                    </p>
                                  </details>
                                </div>
                                <div className="md:col-span-2">
                                  <ProposedWorkPackages
                                    workPackages={review.workPackages}
                                    templates={company.config.tasks}
                                    editing={editing}
                                    disabled={!canEstimate || request.status === "frozen"}
                                    onEdit={() => setEditing(true)}
                                    onChange={(index, next) =>
                                      setReview(
                                        (current) =>
                                          current && {
                                            ...current,
                                            workPackages: current.workPackages.map(
                                              (item, itemIndex) =>
                                                itemIndex === index ? next : item,
                                            ),
                                            confirmed: false,
                                          },
                                      )
                                    }
                                    onRemove={(index) =>
                                      setReview(
                                        (current) =>
                                          current && {
                                            ...current,
                                            workPackages: current.workPackages.filter(
                                              (_, itemIndex) => itemIndex !== index,
                                            ),
                                            confirmed: false,
                                          },
                                      )
                                    }
                                    onAdd={() => {
                                      const template = company.config.tasks[0];
                                      if (!template) return;
                                      const item: ScopeWorkPackage = {
                                        id: crypto.randomUUID(),
                                        taskId: template.id,
                                        title: template.label,
                                        quantity: 1,
                                        complexity: "medium",
                                        owner: "company",
                                        acceptance: "",
                                        dependencies: "",
                                        rationale: "Added by reviewer.",
                                        evidence: "",
                                        evidenceSource: "Reviewer-added",
                                      };
                                      setReview(
                                        (current) =>
                                          current && {
                                            ...current,
                                            workPackages: [...current.workPackages, item],
                                            confirmed: false,
                                          },
                                      );
                                    }}
                                  />
                                </div>
                                <AnalysisFindings
                                  analysis={request.analysis!}
                                  company={company}
                                  findingReviews={findingReviews}
                                  canEstimate={canEstimate}
                                  editing={editing}
                                  frozen={request.status === "frozen"}
                                  onFindingChange={changeFindingReview}
                                />

                                <details className="rounded-xl border border-[var(--line)] p-4">
                                  <summary className="cursor-pointer text-sm font-semibold">
                                    Original request and sources
                                  </summary>
                                  <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--muted)]">
                                    {request.text || "No pasted message."}
                                  </pre>
                                  {request.attachments.length > 0 && (
                                    <ul className="mt-3 space-y-2">
                                      {request.attachments.map((file) => (
                                        <li
                                          key={file.id}
                                          className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs"
                                        >
                                          <span className="min-w-0 break-all">
                                            {file.name} · {file.status.replaceAll("_", " ")} ·{" "}
                                            {file.locators.join(", ") ||
                                              "no page or sheet references"}
                                            {file.message ? ` · ${file.message}` : ""}
                                          </span>
                                          <a
                                            className="shrink-0 underline"
                                            href={`/api/company-workspace?company=${encodeURIComponent(company.id)}&request=${encodeURIComponent(request.id)}&file=${encodeURIComponent(file.id)}`}
                                          >
                                            Download original
                                          </a>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </details>
                              </div>
                            )}
                          </Section>

                          {request.analysis && (
                            <ScopeReviewPanel
                              request={request}
                              company={company}
                              review={review}
                              reviewState={reviewState}
                              editing={editing}
                              canEstimate={canEstimate}
                              busy={!!busy}
                              unsavedScope={unsavedScope}
                              reviewerQuestion={reviewerQuestion}
                              onReviewChange={setReview}
                              onEditingChange={setEditing}
                              onReviewerQuestionChange={setReviewerQuestion}
                              onQuestionResolutionChange={changeQuestionResolution}
                              onAction={action}
                            />
                          )}

                          {review.confirmed &&
                            request.status !== "frozen" &&
                            reviewBlockers.length > 0 && (
                              <Section
                                title="Review required before estimating"
                                description="This scope was confirmed before the current review checks. Reopen it to resolve every question and AI finding and make completion prerequisites explicit."
                              >
                                <ul className="list-inside list-disc space-y-1 text-sm text-amber-950">
                                  {reviewBlockers.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                                <button
                                  className={secondary + " mt-4"}
                                  disabled={!canEstimate || !!busy}
                                  onClick={() => setEditing(true)}
                                >
                                  Reopen scope review
                                </button>
                              </Section>
                            )}
                          {review.confirmed &&
                            request.status !== "frozen" &&
                            reviewBlockers.length === 0 && (
                              <Section
                                id="request-effort"
                                title="Explainable effort plan"
                                description="Effort is calculated from configured task templates and reviewer-selected complexity. It is a planning range, not a calibrated prediction or calendar promise."
                              >
                                {!request.estimate ? (
                                  <button
                                    className={button}
                                    disabled={!canEstimate || !!busy || !review.workPackages.length}
                                    onClick={() =>
                                      void action(
                                        {
                                          action: "estimate",
                                          requestId: request.id,
                                          expectedVersion: request.version,
                                        },
                                        "Effort range calculated from the current task configuration.",
                                      )
                                    }
                                  >
                                    <Sparkles size={15} />
                                    Calculate effort
                                  </button>
                                ) : (
                                  <>
                                    <EstimateTable estimate={request.estimate} />
                                    <button
                                      className={button + " mt-4"}
                                      disabled={!canEstimate || !!busy}
                                      onClick={() =>
                                        void action(
                                          {
                                            action: "freeze",
                                            requestId: request.id,
                                            expectedVersion: request.version,
                                          },
                                          "Plan committed. Track delivery against the approved scope and effort.",
                                        )
                                      }
                                    >
                                      <ShieldCheck size={15} />
                                      Commit plan
                                    </button>
                                  </>
                                )}
                              </Section>
                            )}
                          {request.baselines.length > 0 && (
                            <Section
                              title="Commitment history"
                              description="Each approved plan keeps the scope, effort estimate and company settings used when you committed."
                            >
                              {request.baselines.map((base) => (
                                <details
                                  key={base.id}
                                  className="mb-3 rounded-xl bg-[var(--paper)] p-4"
                                >
                                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                                    <strong>Committed plan {base.revision}</strong>
                                    <span className="text-xs text-estimator-muted">
                                      {new Date(base.createdAt).toLocaleString()}
                                    </span>
                                  </summary>
                                  <div className="mt-4">
                                    <EstimateTable estimate={base.estimate} />
                                  </div>
                                  <details className="mt-4 text-xs text-estimator-muted">
                                    <summary className="cursor-pointer">Plan audit details</summary>
                                    <p className="mt-2">Settings revision {base.configVersion}</p>
                                    <p className="mt-2 break-all font-mono">
                                      SHA-256 {base.sha256}
                                    </p>
                                  </details>
                                </details>
                              ))}
                            </Section>
                          )}
                          {request.status === "frozen" && (
                            <CommitmentTrackingPanel
                              key={request.id}
                              request={request}
                              members={company.members}
                              busy={!!busy}
                              canEdit={canEstimate}
                              onSave={action}
                            />
                          )}
                          {request.status === "frozen" && (
                            <DeliveryPanel
                              key={request.id}
                              company={company}
                              request={request}
                              actorId={data!.actorId}
                              busy={!!busy}
                              action={(body) => action(body, "Delivery review updated.")}
                            />
                          )}
                          <button
                            className="text-xs font-medium text-red-800 underline"
                            type="button"
                            disabled={!canEstimate || request.status === "frozen" || !!busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete “${request.title}” and its attached files? This cannot be undone.`,
                                )
                              )
                                void action(
                                  {
                                    action: "deleteRequest",
                                    requestId: request.id,
                                    expectedVersion: request.version,
                                  },
                                  "Request and attached files deleted.",
                                );
                            }}
                          >
                            Delete request and files
                          </button>
                        </>
                      )}
                      {!creatingRequest && !request && (
                        <Section
                          title="Request unavailable"
                          description="This request may have been removed or is no longer in this workspace."
                        >
                          <button
                            type="button"
                            className={secondary}
                            onClick={() => setRequestView("list")}
                          >
                            <ArrowLeft size={15} />
                            Back to client briefs
                          </button>
                        </Section>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {panel === "settings" && (
              <div className="space-y-5">
                <Section
                  title="Workspace"
                  description="Manage company context and the settings behind your delivery plans."
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field name="Switch workspace">
                      <select
                        className={input}
                        value={companyId}
                        onChange={(event) => {
                          setRequestId("");
                          setRequestView("list");
                          setCreatingRequest(false);
                          setCompanyId(event.target.value);
                          void load(event.target.value);
                        }}
                      >
                        {data!.companies.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="flex items-end">
                      <button className={secondary} onClick={() => setCreatingCompany(true)}>
                        <Plus size={16} />
                        Create workspace
                      </button>
                    </div>
                  </div>
                  <dl className="mt-5 grid gap-4 border-t border-estimator-line pt-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-estimator-muted">AI analysis</dt>
                      <dd className="mt-1 font-medium">
                        {data?.aiReady ? "Connected" : "Setup required"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-estimator-muted">Your access</dt>
                      <dd className="mt-1 capitalize">{company.role}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-estimator-muted">Settings revision</dt>
                      <dd className="mt-1">
                        {company.config.version} · retained with committed plans
                      </dd>
                    </div>
                  </dl>
                </Section>
                <ConfigurationPanel
                  key={`${company.id}:${company.version}`}
                  company={company}
                  busy={!!busy}
                  save={(config) =>
                    action(
                      { action: "saveConfiguration", expectedVersion: company.version, config },
                      "Company settings saved.",
                    )
                  }
                />
              </div>
            )}
            {panel === "knowledge" && (
              <KnowledgePanel
                key={`${company.id}:${company.version}`}
                company={company}
                busy={!!busy}
                action={(body) => action(body, "Company knowledge updated.")}
              />
            )}
            {panel === "members" && (
              <MembersPanel
                company={company}
                actorId={data!.actorId}
                publicDemo={publicDemo}
                busy={!!busy}
                action={(body) => action(body, "Organization access updated.")}
              />
            )}
            {panel === "connectors" && (
              <ConnectorsPanel
                company={company}
                publicDemo={publicDemo}
                busy={!!busy}
                action={(body) => action(body, "Connector settings updated.")}
              />
            )}
            {panel === "audit" && <AuditPanel company={company} publicDemo={publicDemo} />}
            {panel === "evaluation" && (
              <EvaluationPanel
                company={company}
                publicDemo={publicDemo}
                onOpenRequests={() => {
                  setPanel("requests");
                  setRequestView("list");
                  setCreatingRequest(false);
                }}
                onOpenRequest={openRequest}
              />
            )}
          </>
        )}
      </div>
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-estimator-line py-5 text-xs leading-6 text-estimator-muted">
        <p className="max-w-2xl">Source-backed scope. Human review. Explainable effort.</p>
        <span>
          The Estimator ·{" "}
          {publicDemo ? "Shared public demo workspace" : "Private company workspace"}
        </span>
      </footer>
    </main>
  );
}
