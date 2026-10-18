"use client";

import Link from "next/link";
import { useState } from "react";

type Mode = "login" | "register";

export default function SignInForm({ returnTo }: { returnTo: string }) {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/auth/" + mode, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The account request could not be completed.");
      window.location.assign(returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <div className="flex items-start justify-between gap-5">
      <div><p className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">Identity service</p><h2 className="mt-2 text-2xl font-medium tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h2></div>
      <div className="rounded-full bg-[var(--paper)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">Local preview</div>
    </div>
    <div className="mt-6 flex rounded-full bg-[var(--paper)] p-1" role="tablist" aria-label="Account action">
      <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => { setMode("login"); setError(""); }} className={"flex-1 rounded-full px-4 py-2 text-sm " + (mode === "login" ? "bg-white shadow-sm" : "text-[var(--muted)]")}>Sign in</button>
      <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => { setMode("register"); setError(""); }} className={"flex-1 rounded-full px-4 py-2 text-sm " + (mode === "register" ? "bg-white shadow-sm" : "text-[var(--muted)]")}>Create account</button>
    </div>
    <form className="mt-6 space-y-4" onSubmit={submit}>
      {mode === "register" && <div><label className="mb-2 block" htmlFor="displayName">Display name</label><input className="w-full" id="displayName" name="displayName" required maxLength={100} autoComplete="name" /></div>}
      <div><label className="mb-2 block" htmlFor="email">Email</label><input className="w-full" id="email" name="email" required type="email" maxLength={254} autoComplete="email" /></div>
      <div><label className="mb-2 block" htmlFor="password">Password</label><input className="w-full" id="password" name="password" required type="password" minLength={mode === "register" ? 12 : undefined} maxLength={1024} autoComplete={mode === "register" ? "new-password" : "current-password"} /><p className="mt-2 text-xs text-[var(--muted)]">{mode === "register" ? "Use at least 12 characters." : "Enter the password for your local account."}</p></div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={busy} className="flex w-full items-center justify-center rounded-full bg-[var(--ink)] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
    <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Signing in starts a server-verified session. No password or bearer token is stored in browser-readable storage.</p>
    <Link href="/" className="mt-5 inline-flex text-xs text-[var(--muted)] underline underline-offset-4">Return to the landing page</Link>
  </div>;
}
