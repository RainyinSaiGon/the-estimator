"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { IdentityAccount } from "../../lib/identity";

const sampleBrief = `Hi team,

We need to connect our HubSpot CRM to our customer portal. Please import 15,000 existing contacts from a CSV file and sync contact changes every night.

Some records are duplicated or missing company names. We need duplicate detection so we don't create a second customer when the email already exists.

The portal has a REST API, but we haven't shared its documentation yet. We'd like this live in two weeks. Can you tell us what's involved and how much effort it will take?

Thanks,
Maya · Operations Lead`;

type Parser = "ai" | "sample";
type Complexity = "small" | "moderate" | "complex";
type Requirement = { id: string; title: string; evidence: string; evidenceStatus: "verified" | "needs_review"; complexity?: Complexity };
type Scope = {
  summary: string;
  domain: string;
  estimateMode: "integration" | "general";
  requirements: Requirement[];
  risks: string[];
  initialAnswers: Record<string, string>;
  missingInformation: { question: string; reason: string; priority: string }[];
  capabilityFindings: { capability: string; status: string; evidence: string; note: string }[];
  improvements: { title: string; reason: string; priority: string }[];
  qualityNotes: string[];
  parser: string;
  source: { name: string; type: string; characters: number; truncated: boolean; reviewText: string };
  agentRun: { mode: string; model: string | null; elapsedMs: number; subagentCount: number; steps: { id: string; agent: string; status: string; summary: string }[] };
};
type Estimate = {
  hours: number;
  low: number;
  high: number;
  blockers: string[];
  assumptions: string[];
  tasks: { category: string; label: string; base: number; hours: number; low: number; high: number; observations: number }[];
  references: { id: string; name: string; score: number; synthetic?: boolean }[];
  provenance: { mode?: string; dataBasis?: string; historyPolicy?: string };
};
type PrivateRecordSummary = { id: string; title: string; createdAt: string; expiresAt: string };
type PrivateRecordSnapshot = {
  schemaVersion: 1;
  title: string;
  source: Scope["source"];
  originalFile: { name: string; type: string; contentBase64: string } | null;
  suggestedScope: Scope;
  reviewedScope: Scope;
  estimate: Estimate;
  deliveryOutcome: null;
};
type PrivateRecordStatus = { identityConfigured: boolean; legacyMigrationAvailable?: boolean; recordsEnabled: boolean; retentionDays: number; message: string };

const supportedFiles = ".pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,.json,.eml";

function normalizedEvidence(value: string) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-")
    .replace(/\s+/g, " ").trim();
}

function hasSourceEvidence(source: string, quote: string) {
  const normalizedQuote = normalizedEvidence(quote);
  return normalizedQuote.length > 0 && normalizedEvidence(source).includes(normalizedQuote);
}

function scopeForStorage(value: Scope): Scope {
  return { ...value, source: { ...value.source, reviewText: "" } };
}

async function fileContentBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export default function EstimateWorkbench({ identityEnabled = false, account = null }: { identityEnabled?: boolean; account?: IdentityAccount | null }) {
  const router = useRouter();
  const [brief, setBrief] = useState(sampleBrief);
  const [file, setFile] = useState<File | null>(null);
  const [parser, setParser] = useState<Parser>("ai");
  const [capabilityText, setCapabilityText] = useState("");
  const [scope, setScope] = useState<Scope | null>(null);
  const [suggestedScope, setSuggestedScope] = useState<Scope | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "estimate" | "save" | null>(null);
  const [error, setError] = useState("");
  const [recordTitle, setRecordTitle] = useState("");
  const [recordStatus, setRecordStatus] = useState<PrivateRecordStatus | null>(null);
  const [savedRecords, setSavedRecords] = useState<PrivateRecordSummary[]>([]);
  const [recordsSignedIn, setRecordsSignedIn] = useState<boolean | null>(null);
  const [recordsMessage, setRecordsMessage] = useState("");
  const [recordAction, setRecordAction] = useState<string | null>(null);
  const [needsLegacySignIn, setNeedsLegacySignIn] = useState(false);
  const [originalFileDownload, setOriginalFileDownload] = useState<{ name: string; url: string } | null>(null);
  const evidenceReady = scope !== null && scope.requirements.length > 0 && scope.source.reviewText.length > 0 && scope.requirements.every((item) => hasSourceEvidence(scope.source.reviewText, item.evidence));

  async function signOut() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok) router.push("/");
    else setRecordsMessage("Sign out could not be completed. Please try again.");
  }

  function clearReview() {
    setScope(null);
    setSuggestedScope(null);
    setEstimate(null);
    setOriginalFileDownload(null);
    setReviewConfirmed(false);
    setError("");
  }

  const refreshSavedRecords = useCallback(async () => {
    try {
      const statusResponse = await fetch("/api/v1/records/status", { cache: "no-store" });
      const status = await statusResponse.json() as PrivateRecordStatus;
      setRecordStatus(status);
      if (!status.recordsEnabled) {
        setSavedRecords([]);
        setRecordsSignedIn(null);
        return;
      }
      const response = await fetch("/api/v1/records", { cache: "no-store" });
      if (response.status === 401) {
        setSavedRecords([]);
        setRecordsSignedIn(false);
        return;
      }
      if (!response.ok) throw new Error("Your saved estimates could not be loaded.");
      const result = await response.json() as { records: PrivateRecordSummary[] };
      setSavedRecords(result.records);
      setRecordsSignedIn(true);
      setRecordsMessage("");
    } catch {
      setRecordStatus((current) => current ?? { identityConfigured: false, recordsEnabled: false, retentionDays: 90, message: "Private storage could not be reached." });
      setRecordsMessage("Saved estimates could not be loaded. Try again in a moment.");
    }
  }, []);

  async function migrateLegacyWorkspace() {
    setRecordAction("migrate");
    setRecordsMessage("");
    setNeedsLegacySignIn(false);
    try {
      const response = await fetch("/api/v1/records/migrate-owner", { method: "POST" });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        setNeedsLegacySignIn(response.status === 401);
        setRecordsMessage(result.error ?? "The previous workspace could not be moved.");
        return;
      }
      await refreshSavedRecords();
      setRecordsMessage(result.message ?? "The previous workspace was moved.");
    } catch {
      setRecordsMessage("Workspace migration is temporarily unavailable.");
    } finally {
      setRecordAction(null);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshSavedRecords(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshSavedRecords]);
  useEffect(() => () => { if (originalFileDownload) URL.revokeObjectURL(originalFileDownload.url); }, [originalFileDownload]);

  function updateRequirement(index: number, patch: Partial<Requirement>) {
    setScope((current) => current ? {
      ...current,
      requirements: current.requirements.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    } : current);
    setEstimate(null);
    setReviewConfirmed(false);
    setError("");
  }

  function removeRequirement(index: number) {
    setScope((current) => current ? {
      ...current,
      requirements: current.requirements.filter((_, itemIndex) => itemIndex !== index),
    } : current);
    setEstimate(null);
    setReviewConfirmed(false);
    setError("");
  }

  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("analyze");
    setError("");
    setEstimate(null);
    setOriginalFileDownload(null);
    setReviewConfirmed(false);
    const capabilities = capabilityText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    try {
      let body: BodyInit;
      const headers: Record<string, string> = {};
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("parser", parser);
        form.append("capabilities", JSON.stringify(capabilities));
        body = form;
      } else {
        headers["content-type"] = "application/json";
        body = JSON.stringify({ brief, parser, capabilities });
      }
      const response = await fetch("/api/v1/preview", { method: "POST", headers, body });
      const payload = await response.json() as { scope?: Scope; error?: string };
      if (!response.ok || !payload.scope) throw new Error(payload.error ?? "The request could not be analyzed.");
      setScope(payload.scope);
      setSuggestedScope(payload.scope);
      setRecordTitle(payload.scope.summary.replace(/\s+/g, " ").trim().slice(0, 200));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be analyzed.");
    } finally {
      setBusy(null);
    }
  }

  async function estimateReviewedScope() {
    if (!scope || !reviewConfirmed || scope.requirements.length === 0) return;
    setBusy("estimate");
    setError("");
    setEstimate(null);
    try {
      const response = await fetch("/api/v1/preview/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewConfirmed: true, scope }),
      });
      const payload = await response.json() as { estimate?: Estimate; error?: string };
      if (!response.ok || !payload.estimate) throw new Error(payload.error ?? "The estimate could not be created.");
      setEstimate(payload.estimate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The estimate could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function savePrivateEstimate() {
    if (!scope || !suggestedScope || !estimate || !recordTitle.trim()) return;
    setBusy("save");
    setRecordsMessage("");
    try {
      const payload: PrivateRecordSnapshot = {
        schemaVersion: 1,
        title: recordTitle.trim(),
        source: scope.source,
        originalFile: file ? { name: file.name, type: file.type || "application/octet-stream", contentBase64: await fileContentBase64(file) } : null,
        suggestedScope: scopeForStorage(suggestedScope),
        reviewedScope: scopeForStorage(scope),
        estimate,
        deliveryOutcome: null,
      };
      const response = await fetch("/api/v1/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, reviewConfirmed: true, payload }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (response.status === 401) {
        setRecordsSignedIn(false);
        throw new Error("Sign in to save this estimate to your private workspace.");
      }
      if (!response.ok) throw new Error(result.error ?? "The estimate could not be saved.");
      setRecordsSignedIn(true);
      setRecordsMessage("Saved to your private workspace.");
      await refreshSavedRecords();
    } catch (cause) {
      setRecordsMessage(cause instanceof Error ? cause.message : "The estimate could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function openPrivateRecord(recordId: string) {
    setRecordAction(recordId);
    setRecordsMessage("");
    try {
      const response = await fetch(`/api/v1/records/${encodeURIComponent(recordId)}`, { cache: "no-store" });
      const result = await response.json() as { payload?: PrivateRecordSnapshot; error?: string };
      if (response.status === 401) setRecordsSignedIn(false);
      if (!response.ok || !result.payload) throw new Error(result.error ?? "The saved estimate could not be opened.");
      const snapshot = result.payload;
      const source = snapshot.source;
      setSuggestedScope({ ...snapshot.suggestedScope, source });
      setScope({ ...snapshot.reviewedScope, source });
      setEstimate(snapshot.estimate);
      setRecordTitle(snapshot.title);
      setReviewConfirmed(true);
      setBrief(source.reviewText);
      setFile(null);
      if (snapshot.originalFile) {
        const binary = atob(snapshot.originalFile.contentBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        const blob = new Blob([bytes], { type: snapshot.originalFile.type || "application/octet-stream" });
        setOriginalFileDownload({ name: snapshot.originalFile.name, url: URL.createObjectURL(blob) });
      } else {
        setOriginalFileDownload(null);
      }
      setError("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setRecordsMessage(cause instanceof Error ? cause.message : "The saved estimate could not be opened.");
    } finally {
      setRecordAction(null);
    }
  }

  async function deletePrivateRecord(recordId: string) {
    if (!window.confirm("Delete this saved estimate? This cannot be undone.")) return;
    setRecordAction(recordId);
    try {
      const response = await fetch(`/api/v1/records/${encodeURIComponent(recordId)}`, { method: "DELETE" });
      if (response.status === 401) setRecordsSignedIn(false);
      if (!response.ok) throw new Error("The saved estimate could not be deleted.");
      setSavedRecords((current) => current.filter((item) => item.id !== recordId));
      setRecordsMessage("Saved estimate deleted.");
    } catch (cause) {
      setRecordsMessage(cause instanceof Error ? cause.message : "The saved estimate could not be deleted.");
    } finally {
      setRecordAction(null);
    }
  }

  async function deleteAllPrivateRecords() {
    if (!window.confirm("Delete every saved estimate in this private workspace? This cannot be undone.")) return;
    setRecordAction("all");
    try {
      const response = await fetch("/api/v1/records", { method: "DELETE" });
      if (response.status === 401) setRecordsSignedIn(false);
      if (!response.ok) throw new Error("The private workspace could not be deleted.");
      setSavedRecords([]);
      setRecordsMessage("All saved estimates were deleted.");
    } catch (cause) {
      setRecordsMessage(cause instanceof Error ? cause.message : "The private workspace could not be deleted.");
    } finally {
      setRecordAction(null);
    }
  }

  return <main className="mx-auto min-h-screen max-w-7xl px-5 py-6 md:px-10">
    <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
      <Link href="/" className="font-semibold tracking-tight">The Estimator</Link>
      <div className="flex items-center gap-4"><span className="text-right text-xs uppercase tracking-[.16em] text-[var(--muted)]">Local preview · not saved</span>{identityEnabled && (account ? <Link href="/account" className="text-xs underline underline-offset-4">{account.displayName}</Link> : <Link href="/sign-in?returnTo=%2Festimate" className="text-xs underline underline-offset-4">Sign in</Link>)}</div>
    </header>

    <div className="grid gap-8 py-8 lg:grid-cols-[minmax(320px,.8fr)_minmax(0,1.2fr)] lg:gap-10">
      <section>
        <p className="text-xs uppercase tracking-[.2em] text-[var(--muted)]">01 / Client intake</p>
        <h1 className="mt-4 max-w-xl text-4xl font-medium tracking-[-.05em] md:text-5xl">Understand the work before you estimate it.</h1>
        <p className="mt-4 max-w-xl leading-7 text-[var(--muted)]">Bring in a request as text or a common document. Review and correct the extracted work before asking for a planning range.</p>

        <form onSubmit={analyze} className="mt-7 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Analysis mode</legend>
            <div className="grid grid-cols-2 rounded-full border border-[var(--line)] bg-white p-1">
              {(["ai", "sample"] as const).map((value) => <button key={value} type="button" aria-pressed={parser === value} onClick={() => { setParser(value); clearReview(); }} className={`rounded-full px-4 py-2.5 text-sm transition ${parser === value ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                {value === "ai" ? "AI specialist agents" : "Sample rules"}
              </button>)}
            </div>
          </fieldset>

          <div>
            <label htmlFor="client-file" className="mb-2 block text-sm font-medium">Client material</label>
            <input id="client-file" type="file" accept={supportedFiles} onChange={(event) => { setFile(event.target.files?.[0] ?? null); clearReview(); }} className="block w-full rounded-2xl border border-[var(--line)] bg-white p-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-[var(--paper)] file:px-4 file:py-2 file:text-xs file:font-medium" />
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">PDF, Word, Excel, PowerPoint, CSV, text, Markdown, JSON or email · max 10 MB</p>
            {file && <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs"><span className="truncate">Selected: {file.name}</span><button type="button" onClick={() => { setFile(null); clearReview(); }} className="underline">Remove</button></div>}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="brief" className="text-sm font-medium">Or paste the request</label>
              <button type="button" onClick={() => { setFile(null); setBrief(sampleBrief); clearReview(); }} className="text-xs text-[var(--muted)] underline underline-offset-4">Load fictional CRM sample</button>
            </div>
            <textarea id="brief" value={brief} onChange={(event) => { setBrief(event.target.value); clearReview(); }} rows={11} maxLength={20_000} disabled={Boolean(file)} className="w-full resize-y rounded-2xl border border-[var(--line)] bg-white p-4 text-sm leading-6 outline-none focus:border-neutral-500 disabled:opacity-50" />
            <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted)]"><span>{file ? "File will be analyzed instead" : "Source is shown alongside extracted findings"}</span><span>{brief.length.toLocaleString()} / 20,000</span></div>
          </div>

          <div>
            <label htmlFor="capabilities" className="mb-2 block text-sm font-medium">Team capability profile <span className="font-normal text-[var(--muted)]">(optional)</span></label>
            <textarea id="capabilities" value={capabilityText} onChange={(event) => { setCapabilityText(event.target.value); clearReview(); }} rows={3} maxLength={5000} placeholder={"One verified team skill per line\nExample: HubSpot API delivery"} className="w-full resize-y rounded-2xl border border-[var(--line)] bg-white p-4 text-sm leading-6 outline-none focus:border-neutral-500" />
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Only add capabilities your team has confirmed. With no profile, team fit stays unknown.</p>
          </div>

          {parser === "ai" && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">AI mode sends the request text and capability profile to OpenAI for this analysis. This local preview does not save a workspace record; use fictional or non-sensitive material here.</p>}
          {parser === "sample" && <p className="rounded-xl border border-[var(--line)] bg-white p-3 text-xs leading-5 text-[var(--muted)]">Sample mode uses deterministic local rules and does not call an AI provider. Its general-work ranges are uncalibrated planning priors.</p>}

          <button disabled={busy !== null || (!file && brief.trim().length < 30)} className="rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50">{busy === "analyze" ? "Analyzing request…" : scope ? "Analyze again" : "Analyze and review"}</button>
        </form>
        {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      </section>

      <section aria-live="polite" className="min-h-[520px] rounded-[2rem] border border-[var(--line)] bg-white p-5 md:p-8">
        {!scope ? <div className="flex h-full min-h-[460px] flex-col justify-between">
          <div><p className="text-xs uppercase tracking-[.2em] text-[var(--muted)]">02 / Reviewable analysis</p><h2 className="mt-4 text-3xl font-medium tracking-tight">A clearer view of the request.</h2><p className="mt-3 max-w-lg leading-7 text-[var(--muted)]">Analyze the source first. The system will not calculate an estimate until you review and confirm the work items.</p></div>
          <div className="grid grid-cols-2 gap-3">{[["Scope", "Requested work and evidence"], ["Unknowns", "Questions before commitment"], ["Team fit", "Only from a supplied profile"], ["Learning", "Recorded outcomes, not guesses"]].map(([title, description]) => <div key={title} className="rounded-2xl bg-[var(--paper)] p-4"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p></div>)}</div>
        </div> : <div>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-5">
            <div><p className="text-xs uppercase tracking-[.2em] text-[var(--muted)]">02 / Draft scope · {scope.estimateMode === "integration" ? "Integration model" : "General work"}</p><h2 className="mt-3 text-3xl font-medium tracking-[-.04em]">Review before estimating</h2><p className="mt-2 text-sm text-[var(--muted)]">{scope.requirements.length} work item(s) · {scope.parser === "ai" ? `${scope.agentRun.subagentCount} AI specialists` : "Sample rules"}</p></div>
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{estimate ? "Estimate calculated" : "No estimate yet"}</span>
          </div>
          <p className="mt-5 text-sm leading-6">{scope.summary}</p>
          <p className="mt-3 text-xs text-[var(--muted)]">Source: {scope.source.name} · {scope.source.type.toUpperCase()} · {scope.source.characters.toLocaleString()} extracted characters{scope.source.truncated ? " · truncated at the extraction limit" : ""}</p>
          {originalFileDownload && <p className="mt-2 text-xs"><a href={originalFileDownload.url} download={originalFileDownload.name} className="underline underline-offset-2">Download original client file</a></p>}
          <details className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4">
            <summary className="cursor-pointer text-sm font-medium">View extracted source text</summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{scope.source.reviewText}</pre>
          </details>

          <section className="mt-6 rounded-2xl bg-[var(--paper)] p-4">
            <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-medium">Agent harness</h3><span className="text-xs text-[var(--muted)]">{scope.agentRun.elapsedMs ? `${(scope.agentRun.elapsedMs / 1000).toFixed(1)}s` : "local rules"}</span></div>
            <ol className="mt-3 space-y-3">{scope.agentRun.steps.map((step) => <li key={step.id} className="border-t border-[var(--line)] pt-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{step.agent}</p><span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{step.status}</span></div><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{step.summary}</p></li>)}</ol>
          </section>

          <section className="mt-7">
            <div className="flex items-end justify-between gap-4"><div><h3 className="text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Requested work & source evidence</h3><p className="mt-1 text-xs text-[var(--muted)]">Edit the titles, correct quotes, or remove work the client did not ask for.</p></div><span className="text-xs text-[var(--muted)]">{scope.requirements.length} included</span></div>
            <ul className="mt-3 space-y-3">{scope.requirements.map((item, index) => <li key={`${item.id}-${index}`} className="rounded-xl border border-[var(--line)] p-4">
              <div className="flex items-start justify-between gap-3"><label className="min-w-0 flex-1 text-xs font-medium text-[var(--muted)]">Work item title<input aria-label={`Work item ${index + 1} title`} value={item.title} maxLength={240} onChange={(event) => updateRequirement(index, { title: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]" /></label><button type="button" onClick={() => removeRequirement(index)} className="mt-5 rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)] hover:text-red-700">Remove</button></div>
              <div className="mt-3 flex items-center justify-between gap-3"><label htmlFor={`evidence-${index}`} className="text-xs font-medium text-[var(--muted)]">Source quote</label><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${hasSourceEvidence(scope.source.reviewText, item.evidence) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{hasSourceEvidence(scope.source.reviewText, item.evidence) ? "Source verified" : "Needs source review"}</span></div><textarea id={`evidence-${index}`} aria-label={`Work item ${index + 1} source quote`} value={item.evidence} maxLength={1200} onChange={(event) => updateRequirement(index, { evidence: event.target.value, evidenceStatus: hasSourceEvidence(scope.source.reviewText, event.target.value) ? "verified" : "needs_review" })} rows={2} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm leading-5 text-[var(--ink)]" />
              {scope.estimateMode === "general" && <label className="mt-3 block text-xs font-medium text-[var(--muted)]">Rough complexity band<select aria-label={`Work item ${index + 1} complexity`} value={item.complexity ?? "moderate"} onChange={(event) => updateRequirement(index, { complexity: event.target.value as Complexity })} className="mt-1 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]"><option value="small">Small</option><option value="moderate">Moderate</option><option value="complex">Complex</option></select></label>}
            </li>)}</ul>
          </section>

          {scope.missingInformation.length > 0 && <section className="mt-7"><h3 className="text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Questions before committing</h3><ul className="mt-3 space-y-2">{scope.missingInformation.map((item, index) => <li key={`${item.question}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium">{item.question}</p><span className="text-[10px] uppercase text-amber-800">{item.priority}</span></div><p className="mt-1 text-xs leading-5 text-amber-950">{item.reason}</p></li>)}</ul></section>}

          {scope.capabilityFindings.length > 0 && <section className="mt-7"><h3 className="text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Team capability fit</h3><ul className="mt-3 space-y-2">{scope.capabilityFindings.map((item, index) => <li key={`${item.capability}-${index}`} className="rounded-xl border border-[var(--line)] p-4"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium">{item.capability}</p><span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{item.status}</span></div><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.evidence ? `Profile evidence: “${item.evidence}”. ` : ""}{item.note}</p></li>)}</ul></section>}

          {scope.improvements.length > 0 && <section className="mt-7"><h3 className="text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Ways to strengthen the request</h3><ul className="mt-3 space-y-2">{scope.improvements.map((item, index) => <li key={`${item.title}-${index}`} className="rounded-xl bg-[var(--paper)] p-4"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.reason}</p></li>)}</ul></section>}

          {scope.qualityNotes.length > 0 && <section className="mt-6 rounded-xl border border-[var(--line)] p-4"><h3 className="text-sm font-medium">Review notes</h3><ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-[var(--muted)]">{scope.qualityNotes.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}

          <div className="mt-7 border-t border-[var(--line)] pt-5">
            <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => { setReviewConfirmed(event.target.checked); setEstimate(null); }} className="mt-1 size-4 accent-black" /><span>I reviewed the extracted source, work items, and evidence. This scope is ready for a planning estimate.</span></label>
            {!evidenceReady && <p role="status" className="mt-3 text-xs leading-5 text-amber-900">Correct or remove each work item marked “Needs source review” before estimating.</p>}
            <button type="button" onClick={estimateReviewedScope} disabled={busy !== null || !reviewConfirmed || !evidenceReady} className="mt-4 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50">{busy === "estimate" ? "Calculating reviewed scope…" : estimate ? "Recalculate reviewed estimate" : "Confirm scope & estimate"}</button>
            {!estimate && <p className="mt-3 text-xs text-[var(--muted)]">No estimate is requested or shown before you confirm this scope.</p>}
          </div>

          {estimate && <section className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">03 / Planning estimate</p><h3 className="mt-2 text-4xl font-medium tracking-[-.04em]">{estimate.hours} hours</h3></div><p className="text-sm text-[var(--muted)]">Range {estimate.low}–{estimate.high} person-hours</p></div>
            <h4 className="mt-6 text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Effort breakdown</h4>
            <div className="mt-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] px-4">{estimate.tasks.map((task) => <div key={task.category} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{task.label}<small className="ml-2 text-xs text-[var(--muted)]">base {task.base}h</small></span><span className="whitespace-nowrap font-medium">{task.low}–{task.high}h</span></div>)}</div>
            {estimate.assumptions.length > 0 && <section className="mt-6"><h4 className="text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Estimate basis & assumptions</h4><ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-[var(--muted)]">{estimate.assumptions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
            {estimate.blockers.length > 0 && <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4"><h4 className="text-sm font-medium">Questions before committing</h4><ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-amber-950">{estimate.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {estimate.references.length > 0 && <p className="mt-4 text-xs text-[var(--muted)]">{estimate.references.length} comparable reference(s); {estimate.references.every((item) => item.synthetic) ? "all are synthetic demonstrations" : "recorded and synthetic references are shown separately in provenance"}.</p>}
            <p className="mt-5 text-xs leading-5 text-[var(--muted)]">{scope.estimateMode === "general" ? "General-work bands are uncalibrated planning priors." : "Demonstration references are fictional."} This is a planning aid, not a delivery commitment. Nothing is stored unless you explicitly save it to a configured private workspace.</p>
            <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><h4 className="text-sm font-semibold">Save a reviewed estimate privately</h4><p className="mt-1 max-w-xl text-xs leading-5 text-[var(--muted)]">Your original suggestion, reviewed scope, source, and confirmed estimate are encrypted before storage. Saving creates a new immutable snapshot; it never overwrites an earlier one. Records expire after {recordStatus?.retentionDays ?? 90} days.</p></div><span className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">Explicit save</span></div>
              {recordStatus?.recordsEnabled ? recordsSignedIn === false ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white p-4"><p className="text-sm text-[var(--muted)]">Sign in to save or open estimates in your private workspace.</p><Link href="/sign-in?returnTo=%2Festimate" className="rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-medium text-white">Sign in</Link></div> : <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-xs font-medium text-[var(--muted)]">Estimate name<input aria-label="Private estimate name" value={recordTitle} maxLength={200} onChange={(event) => setRecordTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]" /></label><button type="button" onClick={savePrivateEstimate} disabled={busy !== null || !recordTitle.trim() || !suggestedScope} className="rounded-full bg-[var(--ink)] px-5 py-2.5 text-xs font-medium text-white disabled:opacity-50">{busy === "save" ? "Saving privately…" : "Save private estimate"}</button></div> : <p className="mt-4 rounded-xl border border-[var(--line)] bg-white p-4 text-xs leading-5 text-[var(--muted)]">{recordStatus?.message ?? "Checking private storage configuration…"} This preview remains ephemeral until first-party identity and encrypted storage are configured.</p>}
              {recordsMessage && <p role="status" className="mt-3 text-xs leading-5 text-[var(--muted)]">{recordsMessage}</p>}
            </div>
          </section>}
        </div>}
      </section>
    </div>

    <section className="border-t border-[var(--line)] py-8">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">Private workspace</p><h2 className="mt-2 text-2xl font-medium tracking-tight">Saved estimates</h2></div><div className="flex items-center gap-2">{recordsSignedIn === true && <button type="button" onClick={() => void signOut()} className="rounded-full border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]">Sign out</button>}{savedRecords.length > 0 && <button type="button" onClick={deleteAllPrivateRecords} disabled={recordAction !== null} className="rounded-full border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)] hover:text-red-700 disabled:opacity-50">{recordAction === "all" ? "Deleting workspace…" : "Delete all"}</button>}</div></div>
      {recordsSignedIn === true && recordStatus?.legacyMigrationAvailable && <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5"><h3 className="text-sm font-semibold">Move a previous private workspace</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">This links accounts only after you sign in to both. It does not compare email addresses. Existing encrypted records are re-encrypted for this account inside one transaction.</p><div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void migrateLegacyWorkspace()} disabled={recordAction !== null} className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-medium disabled:opacity-50">{recordAction === "migrate" ? "Moving workspace…" : "Move previous workspace"}</button>{needsLegacySignIn && <Link href="/api/auth/signin/oidc?callbackUrl=%2Festimate" className="text-xs underline underline-offset-4">Connect previous sign-in</Link>}</div></div>}
      {!recordStatus?.recordsEnabled ? <p className="mt-3 text-sm text-[var(--muted)]">{recordStatus?.message ?? "Checking configuration…"}</p> : recordsSignedIn === false ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] p-5"><p className="text-sm text-[var(--muted)]">Sign in to view estimates in your private workspace.</p><Link href="/sign-in?returnTo=%2Festimate" className="rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-medium text-white">Sign in</Link></div> : savedRecords.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">{recordsSignedIn === true ? "No saved estimates yet." : "Sign in after private storage is configured to access saved estimates."}</p> : <ul className="mt-4 grid gap-3 md:grid-cols-2">{savedRecords.map((record) => <li key={record.id} className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] p-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{record.title}</p><p className="mt-1 text-xs text-[var(--muted)]">Saved {new Date(record.createdAt).toLocaleDateString()} · expires {new Date(record.expiresAt).toLocaleDateString()}</p></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => openPrivateRecord(record.id)} disabled={recordAction !== null} className="rounded-full border border-[var(--line)] px-3 py-2 text-xs font-medium disabled:opacity-50">{recordAction === record.id ? "Opening…" : "Open"}</button><button type="button" onClick={() => deletePrivateRecord(record.id)} disabled={recordAction !== null} aria-label={`Delete ${record.title}`} className="rounded-full px-3 py-2 text-xs text-[var(--muted)] hover:text-red-700 disabled:opacity-50">Delete</button></div></li>)}</ul>}
      {recordsMessage && !estimate && <p role="status" className="mt-3 text-xs leading-5 text-[var(--muted)]">{recordsMessage}</p>}
    </section>
  </main>;
}
