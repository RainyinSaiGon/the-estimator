import type { ReactNode } from "react";

// Keep all workflow panels on the same Tailwind/theme contract.
export const button = "inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-xl bg-estimator-ink px-4 py-2.5 text-center text-sm font-medium leading-5 text-white shadow-sm transition hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-estimator-accent disabled:cursor-not-allowed disabled:opacity-40";
export const secondary = "inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-xl border border-estimator-line bg-white px-4 py-2.5 text-center text-sm font-medium leading-5 text-estimator-ink transition hover:border-neutral-300 hover:bg-estimator-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-estimator-accent disabled:cursor-not-allowed disabled:opacity-40";
export const input = "mt-2 min-h-11 w-full min-w-0 rounded-xl border border-estimator-line bg-white px-3 py-2.5 text-sm text-estimator-ink outline-none transition placeholder:text-neutral-500 focus:border-estimator-accent focus:ring-2 focus:ring-estimator-accent/20 disabled:bg-neutral-50 disabled:text-neutral-600";
export const label = "block min-w-0 text-[13px] font-medium leading-5 text-estimator-ink";
export const card = "min-w-0 rounded-2xl border border-estimator-line bg-white p-5 shadow-[0_2px_10px_#17191508] sm:p-6";

export function Section({ title, description, children, className = "" }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={`${card} ${className}`}>
    <div className="mb-5 border-b border-estimator-line pb-4">
      <h2 className="text-lg font-semibold tracking-tight text-estimator-ink">{title}</h2>
      {description && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-estimator-muted">{description}</p>}
    </div>
    {children}
  </section>;
}
