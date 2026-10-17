"use client";

import Link from "next/link";
import { useState } from "react";

const sampleBrief = `Hi team,

We need to connect our HubSpot CRM to our customer portal. Please import 15,000 existing contacts from a CSV file and sync contact changes every night.

Some records are duplicated or missing company names. We need duplicate detection so we don't create a second customer when the email already exists.

The portal has a REST API, but we haven't shared its documentation yet. We'd like this live in two weeks. Can you tell us what's involved and how much effort it will take?

Thanks,
Maya · Operations Lead`;

type Preview = {
  scope: { summary: string; requirements: { id: string; title: string; evidence: string }[]; risks: string[]; initialAnswers: Record<string, string> };
  estimate: { hours: number; low: number; high: number; blockers: string[]; assumptions: string[]; tasks: { category: string; label: string; base: number; hours: number; low: number; high: number; observations: number }[]; references: { id: string; name: string; score: number }[] };
};

export default function EstimateWorkbench() {
  const [brief, setBrief] = useState(sampleBrief);
  const [result, setResult] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/v1/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief, parser: "sample" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Preview could not be created.");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview could not be created.");
    } finally { setBusy(false); }
  }

  return <main className="mx-auto min-h-screen max-w-6xl px-6 py-7 md:px-12">
    <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
      <Link href="/" className="font-semibold tracking-tight">The Estimator</Link>
      <span className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">Sample workspace · no saved records</span>
    </header>
    <div className="grid gap-10 py-10 lg:grid-cols-[.85fr_1.15fr]">
      <section>
        <p className="text-xs uppercase tracking-[.2em] text-[var(--muted)]">01 / Client brief</p>
        <h1 className="mt-4 text-4xl font-medium tracking-[-.05em]">Scope an integration request.</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">Start with a fictional CRM and data migration scenario. The sample parser extracts evidence; the Go service estimates delivery effort from explicit task assumptions and labelled demonstration history.</p>
        <form onSubmit={analyze} className="mt-8">
          <label htmlFor="brief" className="mb-2 block text-sm font-medium">Request from the client</label>
          <textarea id="brief" value={brief} onChange={(event) => setBrief(event.target.value)} rows={14} maxLength={20000} className="w-full resize-y rounded-2xl border border-[var(--line)] bg-white p-4 text-sm leading-6 outline-none focus:border-neutral-500" />
          <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]"><span>Parser: Sample rules</span><span>{brief.length.toLocaleString()} / 20,000</span></div>
          <button disabled={busy} className="mt-5 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50">{busy ? "Reading brief…" : "Create estimate preview"}</button>
          <p className="mt-3 text-xs text-[var(--muted)]">AI parsing is unavailable until a hosted API key is configured.</p>
        </form>
        {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      </section>
      <section className="min-h-96 rounded-[2rem] border border-[var(--line)] bg-white p-6 md:p-8">
        {!result ? <div className="flex h-full min-h-80 flex-col justify-between"><div><p className="text-xs uppercase tracking-[.2em] text-[var(--muted)]">02 / Reviewable output</p><h2 className="mt-4 text-2xl font-medium tracking-tight">What is being asked?</h2><p className="mt-3 max-w-lg leading-7 text-[var(--muted)]">The preview will show extracted requirements with their source text, then a task-by-task planning range. Unknowns remain visible for a person to resolve.</p></div><div className="grid grid-cols-2 gap-3">{[["Scope", "Evidence from the brief"], ["Effort", "Person-hours by task"], ["Unknowns", "Visible blockers"], ["History", "Synthetic examples only"]].map(([title, description]) => <div key={title} className="rounded-2xl bg-[var(--paper)] p-4"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p></div>)}</div></div> : <div>
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-6"><div><p className="text-xs uppercase tracking-[.2em] text-[var(--muted)]">03 / Planning estimate</p><h2 className="mt-3 text-3xl font-medium tracking-[-.04em]">{result.estimate.hours} hours</h2><p className="mt-1 text-sm text-[var(--muted)]">Planning range {result.estimate.low}–{result.estimate.high} person-hours</p></div><span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs text-amber-800">Demo history</span></div>
          <p className="mt-5 text-sm leading-6">{result.scope.summary}</p>
          <h3 className="mt-7 text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Requested work & evidence</h3>
          <ul className="mt-3 space-y-3">{result.scope.requirements.map((requirement) => <li key={requirement.id} className="rounded-xl border border-[var(--line)] p-4"><p className="text-sm font-medium">{requirement.title}</p><p className="mt-2 text-sm leading-6 text-[var(--muted)]">“{requirement.evidence}”</p></li>)}</ul>
          <h3 className="mt-7 text-xs font-medium uppercase tracking-[.16em] text-[var(--muted)]">Effort breakdown</h3>
          <div className="mt-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] px-4">{result.estimate.tasks.map((task) => <div key={task.category} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{task.label}<small className="ml-2 text-xs text-[var(--muted)]">base {task.base}h</small></span><span className="whitespace-nowrap font-medium">{task.low}–{task.high}h</span></div>)}</div>
          {result.estimate.blockers.length > 0 && <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="text-sm font-medium">Questions before committing</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-amber-950">{result.estimate.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Demonstration references are fictional. This estimate is a planning aid, not a delivery commitment. The preview is not saved.</p>
        </div>}
      </section>
    </div>
  </main>;
}
