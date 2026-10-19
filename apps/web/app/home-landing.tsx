"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import HomeScreen from "../../../app/home-screen";

export default function HomeLanding({ identityEnabled, displayName }: { identityEnabled: boolean; displayName: string | null }) {
  const router = useRouter();

  return <main className="mx-auto min-h-screen max-w-[1440px] px-6 py-6 sm:px-8 xl:px-12">
    <header className="flex items-center justify-between gap-5 border-b border-[var(--line)] pb-5">
      <Link href="/" className="text-lg font-semibold tracking-tight">The Estimator</Link>
      <div className="flex items-center gap-4 sm:gap-6">
        <span className="hidden text-xs uppercase tracking-[.18em] text-[var(--muted)] sm:inline">Scope with evidence</span>
        {identityEnabled && (displayName
          ? <Link href="/account" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm">{displayName}</Link>
          : <Link href="/sign-in" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm">Sign in</Link>)}
      </div>
    </header>

    <HomeScreen
      onNewRequest={() => router.push("/estimate")}
      onTrySample={() => router.push("/estimate?sample=1")}
      onOpenHistory={() => router.push("/estimate#saved-estimates")}
    />

    <footer className="flex flex-wrap justify-between gap-3 border-t border-[var(--line)] py-6 text-xs text-[var(--muted)]">
      <span>Source-backed scope. Human review. Explainable effort.</span>
      <span>Keep a clear record from first request to delivery.</span>
    </footer>
  </main>;
}
