import Link from "next/link";
import { redirect } from "next/navigation";
import { accountForSession, identityAuthConfigured } from "../../lib/identity";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your account · The Estimator" };

export default async function AccountPage() {
  if (!identityAuthConfigured()) redirect("/");
  const session = await accountForSession();
  if (!session) redirect("/sign-in?returnTo=%2Faccount");

  return <main className="mx-auto min-h-screen max-w-4xl px-6 py-7 md:px-12">
    <header className="flex items-center justify-between border-b border-[var(--line)] pb-5"><Link href="/" className="font-semibold tracking-tight">The Estimator</Link><Link href="/estimate" className="text-sm text-[var(--muted)] underline underline-offset-4">Open estimate preview</Link></header>
    <section className="mx-auto mt-16 max-w-2xl rounded-[1.75rem] border border-[var(--line)] bg-white p-7 shadow-sm md:p-10">
      <p className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">First-party identity</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Your account</h1>
      <dl className="mt-8 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        <div className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr]"><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Display name</dt><dd className="text-sm">{session.account.displayName}</dd></div>
        <div className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr]"><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Email</dt><dd className="text-sm">{session.account.email}</dd></div>
        <div className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr]"><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Session ends</dt><dd className="text-sm">{new Date(session.expiresAt).toLocaleString()}</dd></div>
      </dl>
      <p className="mt-6 rounded-xl bg-[var(--paper)] p-4 text-xs leading-5 text-[var(--muted)]">This account controls the first-party session used to access your private estimates. Signing out revokes this browser session.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <form action="/api/auth/renew" method="post"><button className="rounded-full bg-[var(--ink)] px-5 py-3 text-sm text-white transition hover:opacity-90">Renew session</button></form>
        <form action="/api/auth/logout" method="post"><button className="rounded-full border border-[var(--line)] px-5 py-3 text-sm transition hover:bg-[var(--paper)]">Sign out</button></form>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Renewing rotates the session token. Each sign-in has a 30-day maximum lifetime.</p>
    </section>
  </main>;
}
