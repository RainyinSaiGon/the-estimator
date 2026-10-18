import Link from "next/link";
import RecoveryForm from "./recovery-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Password recovery · The Estimator", referrer: "no-referrer" as const };

export default function PasswordRecoveryPage() {
  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-7 md:px-12">
    <header className="flex items-center justify-between border-b border-[var(--line)] pb-5"><Link href="/" className="font-semibold tracking-tight">The Estimator</Link><span className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">Your workspace</span></header>
    <section className="grid flex-1 items-center gap-12 py-12 md:grid-cols-[.9fr_1.1fr]">
      <div><p className="text-xs font-medium uppercase tracking-[.2em] text-[var(--muted)]">First-party account</p><h1 className="mt-5 max-w-md text-4xl font-medium leading-tight tracking-[-.045em] md:text-5xl">Get back to your work.</h1><p className="mt-5 max-w-md leading-7 text-[var(--muted)]">Recovery links expire after 30 minutes and can be used only once. A completed password reset revokes existing sessions.</p></div>
      <div className="rounded-[1.75rem] border border-[var(--line)] bg-white p-6 shadow-sm md:p-9"><RecoveryForm token="" /></div>
    </section>
  </main>;
}
