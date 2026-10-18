import Link from "next/link";
import VerificationForm from "./verification-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify email · The Estimator", referrer: "no-referrer" as const };

export default function VerifyEmailPage() {
  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-7 md:px-12">
    <header className="flex items-center justify-between border-b border-[var(--line)] pb-5"><Link href="/" className="font-semibold tracking-tight">The Estimator</Link><span className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">Your workspace</span></header>
    <section className="grid flex-1 items-center gap-12 py-12 md:grid-cols-[.9fr_1.1fr]">
      <div><p className="text-xs font-medium uppercase tracking-[.2em] text-[var(--muted)]">Email verification</p><h1 className="mt-5 max-w-md text-4xl font-medium leading-tight tracking-[-.045em] md:text-5xl">Confirm your address.</h1><p className="mt-5 max-w-md leading-7 text-[var(--muted)]">This one-time link expires after 24 hours. Set your password here to finish creating the account.</p></div>
      <div className="rounded-[1.75rem] border border-[var(--line)] bg-white p-6 shadow-sm md:p-9"><VerificationForm token="" /></div>
    </section>
  </main>;
}
