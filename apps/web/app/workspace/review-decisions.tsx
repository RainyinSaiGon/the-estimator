"use client";
import type {
  Analysis,
  QuestionResolution,
  ScopeReview,
} from "../../lib/workflow-types";

export function scopeDecisionRows(analysis: Analysis, review: ScopeReview) {
  return [
    ...[...new Set([...analysis.questions, ...review.questions])]
      .filter((text) => text.trim())
      .map((text) => ({
        text,
        kind: "question" as const,
        value: review.questionResolutions?.[text],
      })),
    ...[...new Set(analysis.conflicts)]
      .filter((text) => text.trim())
      .map((text) => ({
        text,
        kind: "conflict" as const,
        value: review.conflictResolutions?.[text],
      })),
  ];
}
export function unresolvedScopeDecisions(
  analysis: Analysis,
  review: ScopeReview,
) {
  return scopeDecisionRows(analysis, review).filter(
    (row) =>
      !["answered", "not_applicable"].includes(row.value?.disposition ?? "") ||
      (row.value?.resolution.trim().length ?? 0) < 10,
  );
}
export function ScopeDecisions({
  analysis,
  review,
  disabled,
  onChange,
}: {
  analysis: Analysis;
  review: ScopeReview;
  disabled: boolean;
  onChange: (patch: Partial<ScopeReview>) => void;
}) {
  const rows = scopeDecisionRows(analysis, review);
  if (!rows.length)
    return (
      <p className="text-sm text-[var(--muted)]">
        No unresolved questions or conflicts were identified.
      </p>
    );
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-[var(--muted)]">
        Resolve every original AI question and conflict. Removing a question
        from the editable scope does not remove its review requirement.
      </p>
      {rows.map((row) => {
        const key =
          row.kind === "question"
            ? "questionResolutions"
            : "conflictResolutions";
        const value: QuestionResolution = row.value ?? {
          disposition: "",
          resolution: "",
        };
        const update = (patch: Partial<QuestionResolution>) =>
          onChange({
            [key]: { ...review[key], [row.text]: { ...value, ...patch } },
          });
        return (
          <fieldset
            key={row.kind + row.text}
            disabled={disabled}
            className="rounded-xl border border-[var(--line)] p-4"
          >
            <legend className="px-1 text-xs font-semibold capitalize">
              {row.kind}
            </legend>
            <p className="text-sm">{row.text}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]">
              <label className="text-xs">
                Decision
                <select
                  value={value.disposition}
                  className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white p-2 text-sm"
                  onChange={(event) =>
                    update({
                      disposition: event.target
                        .value as QuestionResolution["disposition"],
                    })
                  }
                >
                  <option value="">Needs review</option>
                  <option value="answered">
                    {row.kind === "question" ? "Answered" : "Resolved"}
                  </option>
                  <option value="not_applicable">Not applicable</option>
                </select>
              </label>
              <label className="text-xs">
                Answer or reason
                <textarea
                  rows={2}
                  minLength={10}
                  maxLength={2000}
                  className="mt-1 w-full rounded-xl border border-[var(--line)] p-2 text-sm"
                  value={value.resolution}
                  onChange={(event) =>
                    update({ resolution: event.target.value })
                  }
                />
              </label>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
