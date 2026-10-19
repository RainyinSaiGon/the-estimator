"use client";

import type { ScopeReview } from "../../../lib/client-workflow-types";
import { Field, input } from "../ui";

type QuestionResolution = NonNullable<ScopeReview["questionResolutions"]>[string];

type FindingReview = NonNullable<ScopeReview["findingReviews"]>[string];

export function QuestionReviewEditor({
  question,
  value,
  disabled,
  onChange,
  onRemove,
}: {
  question: string;
  value?: QuestionResolution;
  disabled: boolean;
  onChange: (value: QuestionResolution) => void;
  onRemove?: () => void;
}) {
  return (
    <article className="rounded-xl border border-amber-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm leading-6">{question}</p>
        {onRemove && (
          <button
            className="shrink-0 text-xs font-medium text-red-800 underline"
            type="button"
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <Field name="Review status">
          <select
            className={input}
            disabled={disabled}
            value={value?.disposition ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                disposition: (event.target.value || undefined) as QuestionResolution["disposition"],
                resolution: value?.resolution ?? "",
                ...(value?.question ? { question: value.question } : {}),
              })
            }
          >
            <option value="">Needs a decision</option>
            <option value="answered">Answered</option>
            <option value="not_applicable">Not applicable</option>
          </select>
        </Field>
        <Field name="Answer or reason it does not apply">
          <textarea
            className={input}
            rows={2}
            disabled={disabled}
            required
            value={value?.resolution ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                resolution: event.target.value,
                ...(value?.question ? { question: value.question } : {}),
              })
            }
            placeholder="Record the decision or remaining prerequisite…"
          />
        </Field>
      </div>
    </article>
  );
}

export function FindingReviewEditor({
  value,
  disabled,
  onChange,
}: {
  value?: FindingReview;
  disabled: boolean;
  onChange: (value: FindingReview) => void;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field name="Reviewer decision">
        <select
          className={input}
          disabled={disabled}
          value={value?.disposition ?? ""}
          onChange={(event) =>
            onChange({
              ...value,
              disposition: (event.target.value || undefined) as FindingReview["disposition"],
              correction: value?.correction ?? "",
            })
          }
        >
          <option value="">Needs a decision</option>
          <option value="accepted">Accept finding</option>
          <option value="corrected">Correct finding</option>
          <option value="rejected">Reject finding</option>
        </select>
      </Field>
      {(value?.disposition === "corrected" || value?.disposition === "rejected") && (
        <Field name={value.disposition === "corrected" ? "Correction" : "Reason for rejection"}>
          <textarea
            className={input}
            rows={2}
            required
            disabled={disabled}
            value={value.correction}
            onChange={(event) => onChange({ ...value, correction: event.target.value })}
            placeholder="Keep the reviewer’s correction separate from the AI result…"
          />
        </Field>
      )}
    </div>
  );
}
