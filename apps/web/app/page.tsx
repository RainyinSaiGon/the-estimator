import Link from "next/link";

export default function HomePage() {
  return <main className="mx-auto min-h-screen max-w-6xl px-6 py-7 md:px-12">
    <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
      <Link href="/" className="font-semibold tracking-tight">The Estimator</Link>
      <span className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">Integration delivery</span>
    </header>
    <section className="grid min-h-[76vh] items-center gap-12 py-16 md:grid-cols-[1.15fr_.85fr]">
      <div>
        <p className="mb-7 text-xs font-medium uppercase tracking-[.2em] text-[var(--muted)]">From the client brief to a clear commitment</p>
        <h1 className="max-w-3xl text-5xl font-medium leading-[1.04] tracking-[-.055em] md:text-7xl">Bring clarity to every commitment.</h1>
        <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">Keep the request, the missing answers and the effort in one reviewable place. Start with a fictional integration brief and see the new services work together.</p>
        <Link href="/estimate" className="mt-9 inline-flex items-center gap-3 rounded-full bg-[var(--ink)] px-6 py-3.5 text-sm font-medium text-white transition hover:bg-neutral-700">Try the sample estimate <span aria-hidden="true">↗</span></Link>
        <p className="mt-4 text-xs text-[var(--muted)]">Sample parser · no AI key or client data needed</p>
      </div>
      <div className="rounded-[2rem] border border-[var(--line)] bg-white p-5 shadow-sm md:p-8">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-4 text-xs uppercase tracking-[.16em] text-[var(--muted)]"><span>Integration request</span><span>Preview</span></div>
        <div className="mt-6 rounded-2xl bg-[var(--paper)] p-5 text-sm leading-6 text-neutral-700">“Connect our CRM and portal, import existing contacts, and sync changes every night. The API documentation is still pending.”</div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {[["01", "Requested work"], ["02", "Verified evidence"], ["03", "Missing answers"], ["04", "Effort breakdown"]].map(([n, label]) => <div key={n} className="rounded-xl border border-[var(--line)] p-4"><span className="text-xs text-[var(--muted)]">{n}</span><p className="mt-3 text-sm">{label}</p></div>)}
        </div>
      </div>
    </section>
    <footer className="border-t border-[var(--line)] py-5 text-xs text-[var(--muted)]">A planning aid for CRM, API and data migration work.</footer>
  </main>;
}
