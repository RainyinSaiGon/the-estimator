"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function RecoveryForm({ token }: { token: string }) {
  const [activeToken, setActiveToken] = useState(token);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    const nextToken = token || fragmentToken;
    window.history.replaceState(null, "", "/password-recovery");
    setActiveToken(/^[A-Za-z0-9_-]{43}$/.test(nextToken) ? nextToken : "");
  }, [token]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch(activeToken ? "/api/auth/recovery/complete" : "/api/auth/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activeToken ? { token: activeToken, newPassword: values.newPassword } : { email: values.email }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
      if (activeToken) setComplete(true);
      else setMessage(result.message ?? "If an eligible account exists, recovery instructions will be sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (complete) return <div role="status"><p className="rounded-xl bg-green-50 p-4 text-sm text-green-900">Your password was reset. All existing sign-in sessions have been revoked.</p><Link href="/sign-in" className="mt-5 inline-flex rounded-full bg-[var(--ink)] px-5 py-3 text-sm text-white">Sign in with your new password</Link></div>;

  return <div>
    <h2 className="text-2xl font-medium tracking-tight">{activeToken ? "Choose a new password" : "Recover your account"}</h2>
    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{activeToken ? "Choose a unique password with at least 12 characters." : "Enter your email. If an eligible account exists, recovery instructions will be sent."}</p>
    <form className="mt-6 space-y-4" onSubmit={submit}>
      {activeToken
        ? <div><label className="mb-2 block" htmlFor="newPassword">New password</label><input className="w-full" id="newPassword" name="newPassword" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" /></div>
        : <div><label className="mb-2 block" htmlFor="email">Email</label><input className="w-full" id="email" name="email" type="email" required maxLength={254} autoComplete="email" /></div>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-900">{message}</p>}
      <button disabled={busy} className="flex w-full items-center justify-center rounded-full bg-[var(--ink)] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60">{busy ? "Please wait…" : activeToken ? "Reset password" : "Send recovery email"}</button>
    </form>
    <Link href="/sign-in" className="mt-5 inline-flex text-xs text-[var(--muted)] underline underline-offset-4">Return to sign in</Link>
  </div>;
}
