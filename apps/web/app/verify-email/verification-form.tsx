"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function VerificationForm({ token: initialToken }: { token: string }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Checking your verification link…");
  const [error, setError] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    const activeToken = initialToken || fragmentToken;
    window.history.replaceState(null, "", "/verify-email");
    if (!/^[A-Za-z0-9_-]{43}$/.test(activeToken)) {
      setStatus("This verification link is invalid or expired.");
      setError(true);
      return;
    }
    setToken(activeToken);
    setStatus("Create a password to finish verifying your email.");
  }, [initialToken]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(false);
    const newPassword = new FormData(event.currentTarget).get("newPassword");
    try {
      const response = await fetch("/api/auth/verification/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "This verification link could not be used.");
      setVerified(true);
      setStatus("Your email is verified, your password is set, and your protected session is ready.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "This verification link could not be used.");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <p role={error ? "alert" : "status"} className={"rounded-xl p-4 text-sm leading-6 " + (error ? "bg-amber-50 text-amber-950" : "bg-green-50 text-green-900")}>{status}</p>
    {!error && !verified && token && <form className="mt-5 space-y-4" onSubmit={submit}>
      <div><label className="mb-2 block" htmlFor="newPassword">Create your password</label><input className="w-full" id="newPassword" name="newPassword" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" /><p className="mt-2 text-xs text-[var(--muted)]">Use at least 12 characters. This password is created after mailbox verification.</p></div>
      <button disabled={busy} className="flex w-full items-center justify-center rounded-full bg-[var(--ink)] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60">{busy ? "Verifying…" : "Verify email and set password"}</button>
    </form>}
    {verified && <Link href="/account" className="mt-5 inline-flex rounded-full bg-[var(--ink)] px-5 py-3 text-sm text-white">Open your account</Link>}
    {error && <Link href="/sign-in" className="mt-5 inline-flex rounded-full bg-[var(--ink)] px-5 py-3 text-sm text-white">Return to sign in</Link>}
  </div>;
}
