import Link from "next/link";
import SignInForm from "./sign-in-form";
import { identityAuthConfigured } from "../../lib/identity";

export const metadata = { title: "Sign in · The Estimator" };

function safeReturnTo(value: string | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://estimator.local");
    if (parsed.origin !== "https://estimator.local" || parsed.pathname.startsWith("/api/auth/")) return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const configured = identityAuthConfigured();

  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-7 md:px-12">
    <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
      <Link href="/" className="font-semibold tracking-tight">The Estimator</Link>
      <span className="text-xs uppercase tracking-[.18em] text-[var(--muted)]">Your workspace</span>
    </header>
    <section className="grid flex-1 items-center gap-12 py-12 md:grid-cols-[.9fr_1.1fr]">
      <div>
        <p className="text-xs font-medium uppercase tracking-[.2em] text-[var(--muted)]">First-party account preview</p>
        <h1 className="mt-5 max-w-md text-4xl font-medium leading-tight tracking-[-.045em] md:text-5xl">A private place for every estimate.</h1>
        <p className="mt-5 max-w-md leading-7 text-[var(--muted)]">Create an account to prove the new identity service locally. Your browser receives only a protected session cookie; account credentials stay on the server.</p>
        <p className="mt-6 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950">Prototype only. Email verification, password recovery and MFA are not implemented. Use a unique demo password; do not reuse a password from another service.</p>
      </div>
      <div className="rounded-[1.75rem] border border-[var(--line)] bg-white p-6 shadow-sm md:p-9">
        {configured
          ? <SignInForm returnTo={safeReturnTo(returnTo)} />
          : <div role="status"><h2 className="text-xl font-medium">Local identity service is not configured</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Start the optional identity Compose overlay with the local secrets described in the repository README.</p><Link href="/" className="mt-5 inline-flex rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white">Back to The Estimator</Link></div>}
      </div>
    </section>
  </main>;
}
