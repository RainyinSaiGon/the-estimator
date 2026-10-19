"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, BookOpenCheck } from "lucide-react";
import { button, card, input, label, secondary } from "../ui";

type Source = {
  id: string; title: string; url: string; text: string; status: "draft" | "approved" | "retired";
  sha256: string; addedAt: string; approvedAt?: string; approvedBy?: string; fetched: boolean;
  retrievedAt: string; contentType: string; truncated: boolean; byteLength: number;
};
type KnowledgeState = { company: { id: string; name: string; version: number }; policyVersion: number; allowedDomains: string[]; sources: Source[] };

export default function KnowledgeSourcesManager({ userName }: { userName: string }) {
  const [state, setState] = useState<KnowledgeState>();
  const [domainText, setDomainText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const companyFromQuery = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("company") ?? "";
  const visibleSources = state?.sources.filter(source => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    return !query || [source.title, source.url, source.text, source.status].some(value => value.toLocaleLowerCase().includes(query));
  }) ?? [];

  const load = useCallback(async () => {
    setError("");
    const query = companyFromQuery ? `?company=${encodeURIComponent(companyFromQuery)}` : "";
    const response = await fetch(`/api/company-workspace/knowledge${query}`, { cache: "no-store" });
    const body = await response.json() as KnowledgeState & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not load company knowledge.");
    setState(body);
    setDomainText(body.allowedDomains.join("\n"));
  }, [companyFromQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch(reason => setError(reason instanceof Error ? reason.message : "Could not load company knowledge.")), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(payload: Record<string, unknown>) {
    if (!state) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-workspace/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, companyId: state.company.id }) });
      const body = await response.json() as KnowledgeState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The knowledge action failed.");
      if (body.company && body.allowedDomains) setState(body);
      else await load();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The knowledge action failed."); return false; }
    finally { setBusy(false); }
  }

  async function saveDomains(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domains = domainText.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    if (await send({ action: "setAllowedDomains", domains, policyVersion: state?.policyVersion })) setNotice("Approved source-domain list saved.");
  }

  async function fetchSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send({ action: "fetchSource", url: sourceUrl.trim(), expectedVersion: state?.company.version })) {
      setSourceUrl(""); setNotice("Source fetched as a draft. Review it and approve it before analysis can use it.");
    }
  }

  async function sourceAction(action: "approveSource" | "retireSource", source: Source) {
    if (await send({ action, sourceId: source.id, expectedVersion: state?.company.version })) setNotice(action === "approveSource" ? "Knowledge source approved." : "Knowledge source retired.");
  }

  return <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
    <header className="mb-7 flex flex-col gap-5 border-b border-estimator-line pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3"><span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-estimator-signal text-estimator-signal-ink"><BookOpenCheck size={20}/></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-estimator-muted">The Estimator · company knowledge</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-estimator-ink sm:text-3xl">Approved sources</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-estimator-muted">{state ? `${state.company.name} · ` : ""}Managed by {userName}. New pages stay in draft until an administrator reviews them.</p></div></div>
      <a className={secondary + " shrink-0"} href={state ? `/company-workspace?company=${encodeURIComponent(state.company.id)}` : "/company-workspace"}><ArrowLeft size={16}/>Back to workspace</a>
    </header>

    {error && <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">{error}</div>}
    {notice && <div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">{notice}</div>}
    {!state && !error && <p className="py-12 text-center text-sm text-estimator-muted">Loading company knowledge…</p>}

    {state && <div className="mt-7 space-y-6">
      <section className={`${card} space-y-4`}>
        <div><h2 className="text-lg font-medium tracking-tight text-estimator-ink">Approved source domains</h2><p className="mt-2 text-sm leading-6 text-estimator-muted">Allow exact public hostnames such as docs.example.com. Wildcards, private addresses, custom ports, and redirects are blocked.</p></div>
        <form className="space-y-3" onSubmit={saveDomains}>
          <label className={label}>One hostname per line<textarea className={`${input} min-h-28 font-mono`} maxLength={7000} value={domainText} onChange={event => setDomainText(event.target.value)} placeholder="docs.example.com&#10;developer.example.com"/></label>
          <button className={button} disabled={busy}>{busy ? "Saving…" : "Save approved domains"}</button>
        </form>
      </section>

      <section className={`${card} space-y-4`}>
        <div><h2 className="text-lg font-medium tracking-tight text-estimator-ink">Fetch a source page</h2><p className="mt-2 text-sm leading-6 text-estimator-muted">HTML, plain text, Markdown, and JSON are supported. Downloads are limited to 1 MB and eight seconds. A fetch records the URL, title, SHA-256 digest, content type, and retrieval time.</p></div>
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={fetchSource}>
          <label className={label}>Public HTTPS documentation URL<input className={`${input} min-w-0`} type="url" required maxLength={2048} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://docs.example.com/product"/></label>
          <button className={button} disabled={busy || !state.allowedDomains.length}>{busy ? "Fetching…" : "Fetch as draft"}</button>
        </form>
        {!state.allowedDomains.length && <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">Add at least one approved public hostname before fetching a page.</p>}
      </section>

      <section className={`${card} space-y-4`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-medium tracking-tight text-estimator-ink">Source versions <span className="ml-1 rounded-lg bg-estimator-paper px-2 py-1 text-xs font-medium text-estimator-muted">{state.sources.length}</span></h2><p className="mt-2 text-sm leading-6 text-estimator-muted">Only approved versions are searchable by AI and available through the read-only knowledge connector. Re-fetching creates a new draft version.</p></div><label className="block w-full text-[13px] font-medium leading-5 text-estimator-ink sm:max-w-xs">Find a source<input className={`${input} mt-1`} type="search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="Search title, URL, or text"/></label></div>
        {!state.sources.length && <p className="rounded-xl bg-[var(--paper)] p-4 text-sm text-estimator-muted">No knowledge sources yet.</p>}
        {state.sources.length > 0 && visibleSources.length === 0 && <p className="rounded-xl bg-estimator-paper p-4 text-sm text-estimator-muted">No sources match “{sourceQuery}”.</p>}
        <div className="space-y-4">{[...visibleSources].reverse().map(source => <article key={source.id} className="min-w-0 rounded-2xl border border-estimator-line p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-base font-medium text-estimator-ink">{source.title}</h3><span className={`rounded-full px-2.5 py-1 text-xs ${source.status === "approved" ? "bg-emerald-50 text-emerald-900" : source.status === "retired" ? "bg-neutral-100 text-neutral-700" : "bg-amber-50 text-amber-950"}`}>{source.status}</span></div>
              <a href={source.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs leading-5 text-estimator-muted underline">{source.url || "Manually supplied source"}</a>
            </div>
            {source.status === "draft" && <button className={button} disabled={busy} onClick={() => void sourceAction("approveSource", source)}>Approve version</button>}
            {source.status === "approved" && <button className={secondary} disabled={busy} onClick={() => void sourceAction("retireSource", source)}>Retire version</button>}
          </div>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--paper)] p-3"><dt className="text-estimator-muted">{source.fetched ? "Retrieved" : "Added"}</dt><dd className="mt-1 font-medium text-estimator-ink">{new Date(source.retrievedAt).toLocaleString()}</dd></div>
            <div className="rounded-xl bg-[var(--paper)] p-3"><dt className="text-estimator-muted">Format and size</dt><dd className="mt-1 font-medium text-estimator-ink">{source.contentType} · {source.byteLength.toLocaleString()} bytes{source.truncated ? " · text truncated" : ""}</dd></div>
          </dl>
          <p className="mt-3 break-all font-mono text-[11px] leading-5 text-estimator-muted">SHA-256 · {source.sha256}</p>
          {source.approvedAt && <p className="mt-1 text-xs leading-5 text-estimator-muted">Approved {new Date(source.approvedAt).toLocaleString()}{source.approvedBy ? ` by ${source.approvedBy}` : ""}</p>}
          <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-estimator-ink">Review extracted text</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--paper)] p-4 text-xs leading-5 text-estimator-ink">{source.text}</pre></details>
        </article>)}</div>
      </section>
    </div>}
  </main>;
}
