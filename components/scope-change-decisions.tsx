"use client";
import { useState } from "react";
import type { CommitmentChange } from "../lib/commitment-changes";

export function ScopeChangeDecisions({
  changes,
  canReview,
  busy,
  onReview,
}: {
  changes: CommitmentChange[];
  canReview: boolean;
  busy: boolean;
  onReview: (
    id: string,
    decision: "approved" | "rejected",
    notes: string,
  ) => Promise<unknown>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      {changes.map((change) => (
        <article
          key={change.id}
          className="rounded-xl border border-[var(--line)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold">{change.description}</p>
            <span className="rounded-full bg-[var(--paper)] px-2.5 py-1 text-xs capitalize">
              {change.status}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5">
            <strong>Reason:</strong> {change.reason}
          </p>
          <p className="mt-1 text-xs leading-5">
            <strong>Effort impact:</strong> {change.effortImpact}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Proposed {new Date(change.createdAt).toLocaleString()} by{" "}
            {change.createdName ?? change.createdBy}
          </p>
          {change.status === "proposed" && canReview && (
            <div className="mt-3">
              <label className="block text-xs font-medium">
                Approval or rejection reason
                <textarea
                  rows={2}
                  minLength={10}
                  maxLength={2000}
                  className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  value={notes[change.id] ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    setNotes((current) => ({
                      ...current,
                      [change.id]: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["approved", "rejected"] as const).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={
                      busy || (notes[change.id] ?? "").trim().length < 10
                    }
                    onClick={() =>
                      void onReview(change.id, decision, notes[change.id])
                    }
                    className="rounded-full border border-[var(--line)] px-4 py-2 text-xs font-medium disabled:opacity-40"
                  >
                    {decision === "approved"
                      ? "Approve scope change"
                      : "Reject scope change"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {change.reviewedAt && (
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              {change.status} by {change.reviewedName ?? change.reviewedBy} on{" "}
              {new Date(change.reviewedAt).toLocaleString()}.{" "}
              {change.reviewNotes}
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            The original commitment stays fixed. Added work and its actuals
            remain separate from original-scope evaluation.
          </p>
        </article>
      ))}
    </div>
  );
}
