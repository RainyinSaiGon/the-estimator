"use client";

import { Check, CheckCircle2, Plus, ShieldCheck } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type {
  ClientRequest,
  Company,
  ScopeReview,
  WorkspaceResponse,
} from "../../../lib/client-workflow-types";
import { typeLabel, types } from "../request-presentation";
import type { ScopeReviewState } from "../review-state";
import { button, Field, input, secondary, Section } from "../ui";
import { QuestionReviewEditor } from "./review-editors";

type QuestionResolution = NonNullable<ScopeReview["questionResolutions"]>[string];
type ScopeReviewPanelProps = {
  request: ClientRequest;
  company: Company;
  review: ScopeReview;
  reviewState: ScopeReviewState;
  editing: boolean;
  canEstimate: boolean;
  busy: boolean;
  unsavedScope: boolean;
  reviewerQuestion: string;
  onReviewChange: Dispatch<SetStateAction<ScopeReview | null>>;
  onDiscardChanges: () => void;
  onEditingChange: (value: boolean) => void;
  onReviewerQuestionChange: (value: string) => void;
  onQuestionResolutionChange: (key: string, value: QuestionResolution) => void;
  onAction: (
    body: Record<string, unknown>,
    success: string,
  ) => Promise<WorkspaceResponse | undefined>;
};

export function ScopeReviewPanel({
  request,
  company,
  review,
  reviewState,
  editing,
  canEstimate,
  busy,
  unsavedScope,
  reviewerQuestion,
  onReviewChange,
  onEditingChange,
  onDiscardChanges,
  onReviewerQuestionChange,
  onQuestionResolutionChange,
  onAction,
}: ScopeReviewPanelProps) {
  const { questionRows, reviewerQuestionRows, reviewBlockers } = reviewState;
  return (
    <Section
      id="request-scope"
      title="Human scope review"
      description="Correct deliverables, exclusions, acceptance, dependencies and task packages. Saving edits clears the previous scope confirmation."
    >
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
        <h3 className="text-sm font-semibold text-amber-950">Resolve analysis questions</h3>
        <p className="mt-1 text-xs leading-5 text-amber-950">
          Every AI question and any reviewer-added question needs an answer or a reason it does not
          apply before scope confirmation.
        </p>
        <div className="mt-3 space-y-3">
          {questionRows.map(({ key, question, value }) => (
            <QuestionReviewEditor
              key={key}
              question={question}
              value={value}
              disabled={!canEstimate || !editing || request.status === "frozen"}
              onChange={(next) => onQuestionResolutionChange(key, next)}
            />
          ))}
          {reviewerQuestionRows.map(({ key, question, value }) => (
            <QuestionReviewEditor
              key={key}
              question={question}
              value={value}
              disabled={!canEstimate || !editing || request.status === "frozen"}
              onChange={(next) => onQuestionResolutionChange(key, next)}
              onRemove={() =>
                onReviewChange((current) => {
                  if (!current) return current;
                  const remaining = { ...current.questionResolutions };
                  delete remaining[key];
                  return {
                    ...current,
                    questionResolutions: remaining,
                    confirmed: false,
                  };
                })
              }
            />
          ))}
        </div>
        {!questionRows.length && !reviewerQuestionRows.length && (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No open analysis questions. Add any reviewer question that affects delivery readiness.
          </p>
        )}
        {editing && (
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field name="Add a reviewer question">
              <textarea
                className={input}
                rows={2}
                maxLength={500}
                value={reviewerQuestion}
                onChange={(event) => onReviewerQuestionChange(event.target.value)}
                placeholder="What still needs clarification before this scope is ready?"
              />
            </Field>
            <button
              type="button"
              className={secondary}
              disabled={!canEstimate || !reviewerQuestion.trim()}
              onClick={() => {
                const key = `review:${crypto.randomUUID()}`;
                onQuestionResolutionChange(key, {
                  question: reviewerQuestion.trim(),
                  resolution: "",
                });
                onReviewerQuestionChange("");
              }}
            >
              <Plus size={14} />
              Add question
            </button>
          </div>
        )}
      </div>
      <div className="mb-4 rounded-xl border border-[var(--line)] p-4">
        <h3 className="text-sm font-semibold">Review each AI finding</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Accept each finding or record a correction/rejection with an explanation. The original AI
          result and its evidence remain unchanged.
        </p>
      </div>
      <div className="mb-4">
        <Field name="Reviewed work domain">
          <input
            className={input}
            disabled={!canEstimate || !editing || request.status === "frozen"}
            value={review.domain ?? ""}
            maxLength={100}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    domain: event.target.value,
                    confirmed: false,
                  },
              )
            }
          />
        </Field>
      </div>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        {company.config.fields
          .filter((field) => field.requestTypes.includes(review.requestType))
          .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))
          .map((field) => (
            <Field key={field.key} name={`${field.label}${field.required ? " · required" : ""}`}>
              <textarea
                className={input}
                rows={2}
                maxLength={2000}
                disabled={!canEstimate || !editing || request.status === "frozen"}
                value={review.fieldAnswers?.[field.key] ?? ""}
                onChange={(event) =>
                  onReviewChange(
                    (current) =>
                      current && {
                        ...current,
                        fieldAnswers: {
                          ...current.fieldAnswers,
                          [field.key]: event.target.value,
                        },
                        confirmed: false,
                      },
                  )
                }
              />
            </Field>
          ))}
      </div>
      {request.attachments.some((file) => file.status !== "extracted" || file.truncated) && (
        <label className="mb-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm">
          <input
            type="checkbox"
            disabled={!canEstimate || !editing || request.status === "frozen"}
            checked={review.sourceLimitationsAcknowledged ?? false}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    sourceLimitationsAcknowledged: event.target.checked,
                    confirmed: false,
                  },
              )
            }
          />
          I reviewed the incomplete original sources and reconciled their limitations in this scope.
        </label>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="Request type">
          <select
            className={input}
            disabled={!canEstimate || !editing || request.status === "frozen"}
            value={review.requestType}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    requestType: event.target.value as ScopeReview["requestType"],
                    confirmed: false,
                  },
              )
            }
          >
            {types.map((item) => (
              <option key={item} value={item}>
                {typeLabel[item]}
              </option>
            ))}
          </select>
        </Field>
        <Field name="Product fit">
          <select
            className={input}
            disabled={!editing || request.status === "frozen"}
            value={review.productId}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    productId: event.target.value,
                    confirmed: false,
                  },
              )
            }
          >
            <option value="">Unknown / not configured</option>
            {company.config.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field name="Deliverables">
          <textarea
            className={input}
            rows={4}
            required
            disabled={!editing || request.status === "frozen"}
            value={review.deliverables}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    deliverables: event.target.value,
                    confirmed: false,
                  },
              )
            }
          />
        </Field>
        <Field name="Exclusions">
          <textarea
            className={input}
            rows={4}
            disabled={!editing || request.status === "frozen"}
            value={review.exclusions}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    exclusions: event.target.value,
                    confirmed: false,
                  },
              )
            }
          />
        </Field>
        <Field name="Acceptance criteria · required">
          <textarea
            className={input}
            rows={4}
            required
            disabled={!editing || request.status === "frozen"}
            value={review.acceptance}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    acceptance: event.target.value,
                    confirmed: false,
                  },
              )
            }
            placeholder="Define what complete delivery will mean…"
          />
        </Field>
        <Field name="Dependencies and owners · enter “None identified.” when there are none">
          <textarea
            className={input}
            rows={4}
            required
            disabled={!editing || request.status === "frozen"}
            value={review.dependencies}
            onChange={(event) =>
              onReviewChange(
                (current) =>
                  current && {
                    ...current,
                    dependencies: event.target.value,
                    confirmed: false,
                  },
              )
            }
            placeholder="List prerequisites and owners, or enter “None identified.”"
          />
        </Field>
      </div>
      <div className="mt-5 rounded-xl bg-[var(--paper)] p-4">
        <h3 className="text-sm font-semibold">Task breakdown above</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Use the provisional package rows under the AI summary to review task templates,
          quantities, owners, acceptance criteria, prerequisites and supporting evidence.
        </p>
      </div>
      {review.questions.length > 0 && (
        <div className="mt-5 rounded-xl bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-950">Open questions</h3>
          <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
            {review.questions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              className={button}
              disabled={!canEstimate || !!busy || !unsavedScope}
              onClick={() =>
                void onAction(
                  {
                    action: "saveReview",
                    requestId: request.id,
                    expectedVersion: request.version,
                    review,
                  },
                  "Scope changes saved. Confirm them before estimating.",
                )
              }
            >
              <Check size={15} />
              Save scope changes
            </button>
            <button
              className={secondary}
              disabled={busy}
              onClick={onDiscardChanges}
            >
              {unsavedScope || reviewerQuestion ? "Discard changes" : "Done"}
            </button>
          </>
        ) : (
          <button
            className={secondary}
            disabled={!canEstimate || request.status === "frozen" || !!busy}
            onClick={() => onEditingChange(true)}
          >
            Edit reviewed scope
          </button>
        )}
        {!review.confirmed && request.status !== "frozen" && (
          <button
            className={button}
            disabled={!canEstimate || !!busy || editing || reviewBlockers.length > 0}
            onClick={() =>
              void onAction(
                {
                  action: "confirmScope",
                  requestId: request.id,
                  expectedVersion: request.version,
                  confirmed: true,
                },
                "Scope confirmed. You can now calculate effort.",
              )
            }
          >
            <ShieldCheck size={15} />
            Confirm scope
          </button>
        )}
        {review.confirmed && request.status !== "frozen" && (
          <p className="inline-flex items-center gap-2 text-sm text-green-800">
            <CheckCircle2 size={16} />
            Scope confirmed by {review.confirmedBy}
          </p>
        )}
      </div>
      {!review.confirmed && request.status !== "frozen" && reviewBlockers.length > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950">
          <strong>Resolve before confirming:</strong>
          <ul className="mt-1 list-inside list-disc">
            {reviewBlockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
