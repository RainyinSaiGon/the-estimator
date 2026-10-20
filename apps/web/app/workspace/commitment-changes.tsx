"use client";
import { useState } from "react";
import { ScopeChangeDecisions } from "../../../../components/scope-change-decisions";
import type { ClientRequest, Company } from "../../lib/workflow-types";

export function CommitmentChanges({
  company,
  request,
  busy,
  action,
}: {
  company: Company;
  request: ClientRequest;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState({
    description: "",
    reason: "",
    effortImpact: "",
  });
  const baseline = request.baselines.at(-1)!;
  const canEdit =
    ["admin", "member"].includes(company.role) && !request.deliveryOutcome;
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <h3 className="text-lg font-semibold">Scope change decisions</h3>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        Record new work against this commitment. Approval records a separate
        change; original task effort and delivery evaluation stay fixed.
      </p>
      <div className="mt-4">
        <ScopeChangeDecisions
          changes={request.scopeChanges ?? []}
          canReview={canEdit}
          busy={busy}
          onReview={(changeId, decision, note) =>
            action({
              action: "scope_change.review",
              baselineId: baseline.id,
              changeId,
              decision,
              note,
            })
          }
        />
      </div>
      {canEdit && (
        <form
          className="mt-4 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const saved = await action({
              action: "scope_change.propose",
              baselineId: baseline.id,
              scopeChange: draft,
            });
            if (saved)
              setDraft({ description: "", reason: "", effortImpact: "" });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["description", "Change requested"],
                ["reason", "Reason"],
                ["effortImpact", "Effort impact or review needed"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs font-medium">
                {label}
                <textarea
                  required
                  minLength={3}
                  maxLength={key === "effortImpact" ? 500 : 1000}
                  rows={3}
                  value={draft[key]}
                  disabled={busy}
                  className="mt-1 w-full rounded-xl border border-[var(--line)] p-3 text-sm"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <button
            disabled={busy}
            className="rounded-full border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
          >
            Propose scope change
          </button>
        </form>
      )}
    </section>
  );
}
