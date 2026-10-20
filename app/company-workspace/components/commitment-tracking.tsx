"use client";

import { useState, type FormEvent } from "react";
import { DeliverySchedulePanel } from "../../../components/delivery-schedule";
import { ScopeChangeDecisions } from "../../../components/scope-change-decisions";
import type {
  ClientRequest,
  CompanyMember,
  RequestTaskTracking,
  TaskMilestone,
  WorkspaceResponse,
} from "../../../lib/client-workflow-types";
import { button, Field, input, Metric, secondary, Section } from "../ui";

export function CommitmentTrackingPanel({
  request,
  members,
  busy,
  canEdit,
  onSave,
}: {
  request: ClientRequest;
  members: CompanyMember[];
  busy: boolean;
  canEdit: boolean;
  onSave: (
    body: Record<string, unknown>,
    success: string,
  ) => Promise<WorkspaceResponse | undefined>;
}) {
  const baseline = request.baselines.at(-1);
  const editable = canEdit && !(request.delivery ?? []).some(outcome => outcome.status !== "rejected");
  const packages = baseline?.review.workPackages ?? [];
  const [tasks, setTasks] = useState<RequestTaskTracking[]>(() =>
    packages.map(
      (item) =>
        request.taskTracking?.find((task) => task.workPackageId === item.id) ?? {
          workPackageId: item.id,
          status: "not_started",
          assignee: "",
          plannedStart: "",
          plannedEnd: "",
          blocker: "",
          milestones: [],
        },
    ),
  );
  const [scopeChangeOpen, setScopeChangeOpen] = useState(false);
  const [scopeChange, setScopeChange] = useState({ description: "", reason: "", effortImpact: "" });
  const updateTask = (id: string, patch: Partial<RequestTaskTracking>) =>
    setTasks((current) =>
      current.map((task) => (task.workPackageId === id ? { ...task, ...patch } : task)),
    );
  if (!baseline)
    return (
      <Section
        title="Commit a plan to start tracking"
        description="Approve the scope and calculate effort before committing the plan."
      >
        <p className="text-sm text-estimator-muted">
          Ask an estimator to review the scope and commit the plan first.
        </p>
      </Section>
    );
  const estimate = baseline.estimate;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await onSave(
      {
        action: "saveTracking",
        requestId: request.id,
        expectedVersion: request.version,
        taskTracking: tasks,
        ...(scopeChangeOpen ? { scopeChange } : {}),
      },
      "Commitment tracking saved against the frozen baseline.",
    );
    if (saved && scopeChangeOpen) {
      setScopeChange({ description: "", reason: "", effortImpact: "" });
      setScopeChangeOpen(false);
    }
  }
  return (
    <Section
      id="request-tracking"
      title="Commitment & tracking"
      description="The approved baseline stays fixed. Update delivery progress here and record requested scope changes separately."
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Committed on" value={new Date(baseline.createdAt).toLocaleDateString()} />
        <Metric
          label="Forecast range"
          value={`${estimate.adjustedLowHours ?? estimate.lowHours}–${estimate.adjustedHighHours ?? estimate.highHours} h`}
        />
        <Metric
          label="Central effort"
          value={`${estimate.adjustedHours ?? estimate.baseHours} h`}
        />
        <Metric
          label="Estimate basis"
          value={
            estimate.calibration === "training-history"
              ? "Reviewed delivery history"
              : "Company task templates"
          }
        />
      </div>
      <div className="mb-5 rounded-xl bg-estimator-paper p-3 text-xs leading-5 text-estimator-muted">
        <p>
          Set planned dates using your team’s availability, customer response times and vendor
          dependencies. Effort hours describe work, while dates describe your delivery schedule.
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer">Plan audit details</summary>
          <p className="mt-2 break-all font-mono">SHA-256 {baseline.sha256}</p>
        </details>
      </div>
      {!editable && (
        <p className="mb-4 rounded-lg bg-estimator-paper p-3 text-xs text-estimator-muted">
          Your role can view this commitment but cannot change tracking.
        </p>
      )}
      <form className="space-y-4" onSubmit={submit}>
        {packages.map((item, index) => {
          const tracking = tasks.find((task) => task.workPackageId === item.id)!;
          const taskEstimate = estimate.tasks[index];
          return (
            <article key={item.id} className="rounded-xl border border-estimator-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs text-estimator-muted">
                    {taskEstimate?.lowHours ?? "—"}–{taskEstimate?.highHours ?? "—"} h · central{" "}
                    {taskEstimate?.adjustedHours ?? taskEstimate?.baseHours ?? "—"} h · {item.owner}{" "}
                    owned
                  </p>
                </div>
                <span className="rounded-md bg-estimator-paper px-2 py-1 text-xs text-estimator-muted">
                  Task {index + 1}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field name="Task status">
                  <select
                    className={input}
                    value={tracking.status}
                    disabled={busy || !editable}
                    onChange={(event) =>
                      updateTask(item.id, {
                        status: event.target.value as RequestTaskTracking["status"],
                      })
                    }
                  >
                    <option value="not_started">Not started</option>
                    <option value="in_progress">In progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="complete">Complete</option>
                  </select>
                </Field>
                <Field name="Assigned member">
                  <select
                    className={input}
                    value={tracking.assignee}
                    disabled={busy || !editable}
                    onChange={(event) => updateTask(item.id, { assignee: event.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName} · {member.role}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field name="Planned start">
                  <input
                    className={input}
                    type="date"
                    value={tracking.plannedStart}
                    disabled={busy || !editable}
                    onChange={(event) => updateTask(item.id, { plannedStart: event.target.value })}
                  />
                </Field>
                <Field name="Planned finish">
                  <input
                    className={input}
                    type="date"
                    value={tracking.plannedEnd}
                    disabled={busy || !editable}
                    onChange={(event) => updateTask(item.id, { plannedEnd: event.target.value })}
                  />
                </Field>
              </div>
              {tracking.status === "blocked" && (
                <Field name="Blocker · required">
                  <textarea
                    className={input}
                    rows={2}
                    required
                    maxLength={1000}
                    value={tracking.blocker}
                    disabled={busy || !editable}
                    onChange={(event) => updateTask(item.id, { blocker: event.target.value })}
                    placeholder="Describe what is blocking progress and who can resolve it."
                  />
                </Field>
              )}
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">Milestones</h4>
                  <button
                    type="button"
                    className="text-xs font-medium underline"
                    disabled={busy || !editable || tracking.milestones.length >= 20}
                    onClick={() =>
                      updateTask(item.id, {
                        milestones: [
                          ...tracking.milestones,
                          { id: crypto.randomUUID(), title: "", dueDate: "", status: "pending" },
                        ],
                      })
                    }
                  >
                    Add milestone
                  </button>
                </div>
                {!tracking.milestones.length && (
                  <p className="mt-2 text-xs text-estimator-muted">No milestones added.</p>
                )}
                <div className="mt-2 space-y-2">
                  {tracking.milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="grid gap-2 rounded-lg bg-estimator-canvas/60 p-2 sm:grid-cols-[minmax(0,1fr)_160px_150px_auto] sm:items-end"
                    >
                      <Field name="Milestone">
                        <input
                          className={input}
                          required
                          maxLength={160}
                          value={milestone.title}
                          disabled={busy || !editable}
                          onChange={(event) =>
                            updateTask(item.id, {
                              milestones: tracking.milestones.map((value) =>
                                value.id === milestone.id
                                  ? { ...value, title: event.target.value }
                                  : value,
                              ),
                            })
                          }
                          placeholder="e.g. Customer validation"
                        />
                      </Field>
                      <Field name="Due date">
                        <input
                          className={input}
                          type="date"
                          value={milestone.dueDate}
                          disabled={busy || !editable}
                          onChange={(event) =>
                            updateTask(item.id, {
                              milestones: tracking.milestones.map((value) =>
                                value.id === milestone.id
                                  ? { ...value, dueDate: event.target.value }
                                  : value,
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field name="Status">
                        <select
                          className={input}
                          value={milestone.status}
                          disabled={busy || !editable}
                          onChange={(event) =>
                            updateTask(item.id, {
                              milestones: tracking.milestones.map((value) =>
                                value.id === milestone.id
                                  ? {
                                      ...value,
                                      status: event.target.value as TaskMilestone["status"],
                                    }
                                  : value,
                              ),
                            })
                          }
                        >
                          <option value="pending">Pending</option>
                          <option value="complete">Complete</option>
                        </select>
                      </Field>
                      <button
                        type="button"
                        className="mb-2 text-xs text-red-800 underline"
                        disabled={busy || !editable}
                        onClick={() =>
                          updateTask(item.id, {
                            milestones: tracking.milestones.filter(
                              (value) => value.id !== milestone.id,
                            ),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button className={button} disabled={busy || !editable || !packages.length}>
            Save task tracking
          </button>
          <button
            type="button"
            className={secondary}
            disabled={busy || !editable}
            onClick={() => setScopeChangeOpen((value) => !value)}
          >
            {scopeChangeOpen ? "Cancel scope change" : "Log a scope change"}
          </button>
        </div>
        {scopeChangeOpen && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
            <h3 className="font-semibold">Requested change after approval</h3>
            <p className="mt-1 text-xs leading-5 text-estimator-muted">
              This entry is appended to the request. It does not rewrite the frozen scope or effort
              baseline.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Field name="Change requested">
                <textarea
                  className={input}
                  required
                  rows={3}
                  maxLength={1000}
                  value={scopeChange.description}
                  onChange={(event) =>
                    setScopeChange((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </Field>
              <Field name="Reason">
                <textarea
                  className={input}
                  required
                  rows={3}
                  maxLength={1000}
                  value={scopeChange.reason}
                  onChange={(event) =>
                    setScopeChange((current) => ({ ...current, reason: event.target.value }))
                  }
                />
              </Field>
              <Field name="Effort impact or review needed">
                <textarea
                  className={input}
                  required
                  rows={3}
                  maxLength={500}
                  value={scopeChange.effortImpact}
                  onChange={(event) =>
                    setScopeChange((current) => ({ ...current, effortImpact: event.target.value }))
                  }
                  placeholder="Estimate separately after approval"
                />
              </Field>
            </div>
          </div>
        )}
      </form>
      <div className="mt-6"><DeliverySchedulePanel
        key={request.id + ":" + (request.schedule?.plannedAt ?? "new")}
        work={packages.map((item, index) => ({ id: item.id, title: item.title, owner: item.owner, hours: estimate.tasks[index]?.adjustedHours ?? estimate.tasks[index]?.baseHours ?? 0 }))}
        members={members.map(member => ({ id: member.userId, label: member.displayName }))}
        schedule={request.schedule}
        busy={busy}
        canEdit={canEdit && !(request.delivery ?? []).some(outcome => outcome.status !== "rejected")}
        onSave={schedule => onSave({ action: "saveSchedule", requestId: request.id, expectedVersion: request.version, schedule }, "Delivery dates planned using declared availability.")}
        onApply={async () => {
          const next = await onSave({ action: "applySchedule", requestId: request.id, expectedVersion: request.version }, "Scheduled dates applied to task tracking.");
          const saved = next?.company?.requests.find(item => item.id === request.id);
          if (saved) setTasks(current => current.map(task => { const updated = saved.taskTracking?.find(item => item.workPackageId === task.workPackageId); return updated ? { ...task, assignee: updated.assignee, plannedStart: updated.plannedStart, plannedEnd: updated.plannedEnd } : task; }));
        }}
      /></div>
      {!!request.scopeChanges?.length && <div className="mt-6"><h3 className="mb-3 text-sm font-semibold">Scope change decisions</h3><ScopeChangeDecisions changes={request.scopeChanges} canReview={editable} busy={busy} onReview={(changeId, decision, notes) => onSave({ action: "reviewScopeChange", requestId: request.id, expectedVersion: request.version, changeId, decision, notes }, "Scope change decision recorded. The original baseline stays fixed.")} /></div>}
    </Section>
  );
}
