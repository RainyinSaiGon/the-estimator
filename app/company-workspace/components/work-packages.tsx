"use client";

import { Plus } from "lucide-react";
import type { CompanyConfig, ScopeWorkPackage } from "../../../lib/client-workflow-types";
import { Field, input, secondary } from "../ui";

export function ProposedWorkPackages({
  workPackages,
  templates,
  editing,
  disabled,
  onEdit,
  onChange,
  onRemove,
  onAdd,
}: {
  workPackages: ScopeWorkPackage[];
  templates: CompanyConfig["tasks"];
  editing: boolean;
  disabled: boolean;
  onEdit: () => void;
  onChange: (index: number, value: ScopeWorkPackage) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  return (
    <section
      className="rounded-2xl border border-estimator-line bg-white p-4 sm:p-5"
      aria-label="Proposed work packages"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-estimator-muted">
            Scope review · provisional
          </p>
          <h3 className="mt-1 text-base font-semibold">Suggested tasks</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-estimator-muted">
            Review every task against the brief. AI suggestions do not include effort; the estimator
            calculates hours after scope approval.
          </p>
        </div>
        {!editing && (
          <button type="button" className={secondary} disabled={disabled} onClick={onEdit}>
            Edit task breakdown
          </button>
        )}
      </div>
      {!workPackages.length && (
        <p className="mt-4 rounded-xl bg-estimator-paper p-4 text-sm text-estimator-muted">
          No tasks were proposed. Add work packages during scope review.
        </p>
      )}
      <div className="mt-4 space-y-3">
        {workPackages.map((item, index) => (
          <article
            key={item.id}
            className="rounded-xl border border-estimator-line bg-estimator-canvas/40 p-3.5 sm:p-4"
          >
            {editing ? (
              <WorkPackageEditor
                item={item}
                index={index}
                templates={templates}
                disabled={disabled}
                onChange={(value) => onChange(index, value)}
                onRemove={() => onRemove(index)}
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold">{item.title}</h4>
                    <span className="rounded-md bg-estimator-paper px-2 py-1 text-[11px] text-estimator-muted">
                      {item.quantity} × {item.complexity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-estimator-muted">
                    Task template:{" "}
                    {templates.find((template) => template.id === item.taskId)?.label ??
                      item.taskId}{" "}
                    · owner: {item.owner}
                  </p>
                  <p className="mt-3 text-sm leading-5">
                    <strong className="font-medium">Completion:</strong>{" "}
                    {item.acceptance || "Needs reviewer criteria"}
                  </p>
                  <p className="mt-2 text-sm leading-5">
                    <strong className="font-medium">Prerequisites:</strong>{" "}
                    {item.dependencies || "Needs reviewer input"}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-estimator-muted">
                    AI rationale · verify during review
                  </p>
                  <p className="mt-1 text-sm leading-5">
                    {item.rationale || "No rationale returned. Confirm this task from the request."}
                  </p>
                  {item.evidence ? (
                    <blockquote className="mt-2 border-l-2 border-estimator-accent pl-2 text-xs leading-5 text-estimator-muted">
                      “{item.evidence}”
                      <span className="mt-1 block font-medium">
                        {item.evidenceSource || "Verified client source"}
                      </span>
                    </blockquote>
                  ) : (
                    <p className="mt-2 text-xs text-amber-800">
                      {item.evidenceSource ||
                        "No exact source quote verified; treat the proposal as an inference."}
                    </p>
                  )}
                </div>
              </div>
            )}
            {editing && (
              <div className="mt-3 rounded-lg bg-white p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-estimator-muted">
                  AI rationale · verify during review
                </p>
                <p className="mt-1 text-sm leading-5">
                  {item.rationale || "No rationale returned; confirm this task from the request."}
                </p>
                {item.evidence ? (
                  <blockquote className="mt-2 border-l-2 border-estimator-accent pl-2 text-xs leading-5 text-estimator-muted">
                    “{item.evidence}”
                    <span className="mt-1 block font-medium">
                      {item.evidenceSource || "Verified client source"}
                    </span>
                  </blockquote>
                ) : (
                  <p className="mt-2 text-xs text-amber-800">
                    No exact supporting quote was verified.
                  </p>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={secondary}
            disabled={disabled || workPackages.length >= 20}
            onClick={onAdd}
          >
            <Plus size={14} />
            Add work package
          </button>
          <span className="text-xs text-estimator-muted">
            Save or cancel from the scope review below.
          </span>
        </div>
      )}
    </section>
  );
}

function WorkPackageEditor({
  item,
  index,
  templates,
  disabled,
  onChange,
  onRemove,
}: {
  item: ScopeWorkPackage;
  index: number;
  templates: CompanyConfig["tasks"];
  disabled: boolean;
  onChange: (value: ScopeWorkPackage) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_90px_110px]">
        <Field name={`Package ${index + 1}`}>
          <input
            className={input}
            disabled={disabled}
            value={item.title}
            onChange={(event) => onChange({ ...item, title: event.target.value })}
          />
        </Field>
        <Field name="Task template">
          <select
            className={input}
            disabled={disabled}
            value={item.taskId}
            onChange={(event) => {
              const template = templates.find((task) => task.id === event.target.value);
              onChange({
                ...item,
                taskId: event.target.value,
                title: template?.label ?? item.title,
              });
            }}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
        </Field>
        <Field name="Quantity">
          <input
            className={input}
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            disabled={disabled}
            value={item.quantity}
            onChange={(event) => onChange({ ...item, quantity: Number(event.target.value) })}
          />
        </Field>
        <Field name="Complexity">
          <select
            className={input}
            disabled={disabled}
            value={item.complexity}
            onChange={(event) =>
              onChange({
                ...item,
                complexity: event.target.value as ScopeWorkPackage["complexity"],
              })
            }
          >
            <option>low</option>
            <option>medium</option>
            <option>high</option>
          </select>
        </Field>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field name="Prerequisites and owner · state none if there are no prerequisites">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className={input}
              disabled={disabled}
              value={item.owner}
              onChange={(event) =>
                onChange({ ...item, owner: event.target.value as ScopeWorkPackage["owner"] })
              }
            >
              <option value="company">Company</option>
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
            </select>
            <input
              className={input}
              required
              disabled={disabled}
              value={item.dependencies}
              onChange={(event) => onChange({ ...item, dependencies: event.target.value })}
              placeholder="Prerequisite, owner, or ‘None identified.’"
            />
          </div>
        </Field>
        <Field name="Acceptance criteria · required">
          <input
            className={input}
            required
            disabled={disabled}
            value={item.acceptance}
            onChange={(event) => onChange({ ...item, acceptance: event.target.value })}
            placeholder="How will this package be accepted?"
          />
        </Field>
      </div>
      {!disabled && (
        <button
          className="mt-3 text-xs font-medium text-red-800 underline"
          type="button"
          onClick={onRemove}
        >
          Remove package
        </button>
      )}
    </div>
  );
}
