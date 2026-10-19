import type { ReactNode } from "react";

// Keep all workflow panels on the same Tailwind/theme contract.
export const button = "inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full bg-estimator-ink px-5 py-2.5 text-center text-sm font-medium leading-5 text-white transition hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-estimator-accent disabled:cursor-not-allowed disabled:opacity-40";
export const secondary = "inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full border border-estimator-line bg-white px-4 py-2.5 text-center text-sm font-medium leading-5 text-estimator-ink transition hover:bg-estimator-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-estimator-accent disabled:cursor-not-allowed disabled:opacity-40";
export const input = "mt-2 min-h-11 w-full min-w-0 rounded-xl border border-estimator-line bg-white px-3 py-2.5 text-sm text-estimator-ink outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 disabled:bg-neutral-50 disabled:text-neutral-600";
export const label = "block min-w-0 text-xs font-medium leading-5 text-estimator-muted";
export const card = "min-w-0 rounded-2xl border border-estimator-line bg-white p-5 shadow-[0_1px_3px_#17191505] sm:p-6";

export function Section({ title, description, children, className = "" }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={`${card} ${className}`}>
    <div className="mb-5">
      <h2 className="text-lg font-medium tracking-tight text-estimator-ink">{title}</h2>
      {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-estimator-muted">{description}</p>}
    </div>
    {children}
  </section>;
}
