"use client";

import { useState } from "react";

export default function EmailVerificationAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function requestVerification() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/auth/verification", { method: "POST" });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "The verification request could not be completed.");
      setMessage(result.message ?? "If your email still needs verification, a link will be sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verification request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-4">
    <button type="button" disabled={busy} onClick={requestVerification} className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:bg-[var(--paper)] disabled:opacity-60">
      {busy ? "Sending…" : "Resend verification email"}
    </button>
    {message && <p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
  </div>;
}
