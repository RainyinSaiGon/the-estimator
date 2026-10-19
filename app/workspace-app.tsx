"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function WorkspaceApp({ guest }: { guest?: boolean }) {
  void guest;
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const target = new URL("/company-workspace", window.location.origin);

    // Keep old entry links useful while sending every new request to the AI
    // company workflow and its shared request history.
    if (query.has("start") || query.get("new") === "1") target.searchParams.set("new", "1");
    else if (query.get("view") === "history") target.searchParams.set("view", "history");

    window.location.replace(`${target.pathname}${target.search}`);
  }, []);

  return <main className="grid min-h-dvh place-items-center bg-estimator-paper px-5 font-sans text-estimator-muted" aria-live="polite">
    <p className="flex items-center gap-3 text-sm"><Loader2 size={17} className="animate-spin" />Opening your request workspace…</p>
  </main>;
}
