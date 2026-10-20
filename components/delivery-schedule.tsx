"use client";

import { useState, type FormEvent } from "react";
import type {
  DeliverySchedule,
  DeliveryScheduleInput,
  ScheduleWork,
} from "../lib/delivery-schedule";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:opacity-60";
const dateList = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export function DeliverySchedulePanel({
  work,
  members,
  schedule,
  busy,
  canEdit,
  onSave,
  onApply,
}: {
  work: ScheduleWork[];
  members: { id: string; label: string }[];
  schedule?: DeliverySchedule;
  busy: boolean;
  canEdit: boolean;
  onSave: (input: DeliveryScheduleInput) => Promise<unknown>;
  onApply?: () => Promise<unknown>;
}) {
  const [startDate, setStartDate] = useState(schedule?.input.startDate ?? "");
  const [weekdays, setWeekdays] = useState(
    schedule?.input.workingWeekdays ?? [1, 2, 3, 4, 5],
  );
  const [holidays, setHolidays] = useState(
    schedule?.input.holidays.join(", ") ?? "",
  );
  const [tasks, setTasks] = useState(() =>
    work.map(
      (item) =>
        schedule?.input.tasks.find((task) => task.id === item.id) ?? {
          id: item.id,
          assigneeId: "",
          dependencyIds: [],
          notBefore: "",
        },
    ),
  );
  const [resources, setResources] = useState(() =>
    members.map((member) => {
      const saved = schedule?.input.resources.find(
        (resource) => resource.id === member.id,
      );
      return {
        id: member.id,
        dailyHours: String(saved?.dailyHours ?? 6),
        exceptions: Object.entries(saved?.exceptions ?? {})
          .map(([date, hours]) => `${date}=${hours}`)
          .join("\n"),
      };
    }),
  );
  const [error, setError] = useState("");
  const updateTask = (
    id: string,
    patch: Partial<DeliveryScheduleInput["tasks"][number]>,
  ) =>
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const selected = new Set(
        tasks.map((task) => task.assigneeId).filter(Boolean),
      );
      const capacity = resources
        .filter((resource) => selected.has(resource.id))
        .map((resource) => {
          const exceptions: Record<string, number> = {};
          for (const line of resource.exceptions
            .split(/\r?\n/)
            .filter((line) => line.trim())) {
            const match = /^(\d{4}-\d{2}-\d{2})\s*=\s*(\d+(?:\.\d+)?)$/.exec(
              line.trim(),
            );
            if (!match || match[1] in exceptions)
              throw new Error(
                "Use one unique date=available-hours entry per line, such as 2026-10-26=4.",
              );
            exceptions[match[1]] = Number(match[2]);
          }
          return {
            id: resource.id,
            dailyHours: Number(resource.dailyHours),
            exceptions,
          };
        });
      await onSave({
        startDate,
        workingWeekdays: weekdays,
        holidays: dateList(holidays),
        resources: capacity,
        tasks,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The schedule could not be planned.",
      );
    }
  }
  return (
    <section
      aria-label="Delivery schedule"
      className="rounded-2xl border border-[var(--line)] bg-white p-5"
    >
      <h3 className="text-lg font-semibold">Plan delivery dates</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        Use the committed central effort and your declared availability to plan
        dates. Tasks sharing a person share that person’s daily capacity.
        Dependencies finish before the next task starts.
      </p>
      {schedule && (
        <div role="status" className="mt-4 rounded-xl bg-[var(--paper)] p-4">
          <p className="text-sm font-semibold">
            Planned finish: {schedule.finishDate}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Saved {new Date(schedule.plannedAt).toLocaleString()}. This schedule
            is stored separately from the approved effort baseline.
          </p>
        </div>
      )}
      {schedule && onApply && (
        <div className="mt-3">
          <button
            type="button"
            disabled={busy || !canEdit}
            className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium disabled:opacity-40"
            onClick={() => void onApply()}
          >
            Apply scheduled dates to task tracking
          </button>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Applies these assignments and dates while keeping task progress,
            milestones, and the commitment baseline.
          </p>
        </div>
      )}
      <details className="mt-4" open={!schedule}>
        <summary className="cursor-pointer text-sm font-medium">
          {schedule
            ? "Review availability and replan"
            : "Set availability and task order"}
        </summary>
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <fieldset disabled={busy || !canEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium">
                Plan start
                <input
                  required
                  type="date"
                  className={inputClass}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label className="text-xs font-medium">
                Company holidays
                <input
                  className={inputClass}
                  value={holidays}
                  onChange={(event) => setHolidays(event.target.value)}
                  placeholder="YYYY-MM-DD, YYYY-MM-DD"
                />
              </label>
            </div>
            <div>
              <p className="text-xs font-medium">Working weekdays</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day, index) => (
                    <label
                      key={day}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={weekdays.includes(index)}
                        onChange={(event) =>
                          setWeekdays((current) =>
                            event.target.checked
                              ? [...current, index]
                              : current.filter((value) => value !== index),
                          )
                        }
                      />
                      {day}
                    </label>
                  ),
                )}
              </div>
            </div>
            {work.map((item) => {
              const task = tasks.find((task) => task.id === item.id)!;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-[var(--line)] p-3"
                >
                  <p className="text-sm font-medium">
                    {item.title}{" "}
                    <span className="text-xs font-normal text-[var(--muted)]">
                      {item.owner === "company"
                        ? `${item.hours} h central`
                        : "External prerequisite"}
                    </span>
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {item.owner === "company" && (
                      <label className="text-xs">
                        Assigned member
                        <select
                          required
                          className={inputClass}
                          value={task.assigneeId}
                          onChange={(event) =>
                            updateTask(item.id, {
                              assigneeId: event.target.value,
                            })
                          }
                        >
                          <option value="">Choose a member</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="text-xs">
                      {item.owner === "company"
                        ? "Cannot start before (optional)"
                        : "Confirmed ready date"}
                      <input
                        className={inputClass}
                        type="date"
                        required={item.owner !== "company"}
                        value={task.notBefore}
                        onChange={(event) =>
                          updateTask(item.id, { notBefore: event.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs sm:col-span-2">
                      Depends on completed tasks
                      <select
                        multiple
                        className={inputClass}
                        value={task.dependencyIds}
                        onChange={(event) =>
                          updateTask(item.id, {
                            dependencyIds: Array.from(
                              event.target.selectedOptions,
                              (option) => option.value,
                            ),
                          })
                        }
                      >
                        {work
                          .filter((other) => other.id !== item.id)
                          .map((other) => (
                            <option key={other.id} value={other.id}>
                              {other.title}
                            </option>
                          ))}
                      </select>
                      <span className="mt-1 block text-[var(--muted)]">
                        Choose only confirmed dependencies. Use Ctrl or Command
                        to select multiple tasks.
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
            {resources
              .filter((resource) =>
                tasks.some((task) => task.assigneeId === resource.id),
              )
              .map((resource) => (
                <div
                  key={resource.id}
                  className="rounded-xl bg-[var(--paper)] p-3"
                >
                  <p className="text-sm font-medium">
                    {members.find((member) => member.id === resource.id)?.label}
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs">
                      Available hours per working day
                      <input
                        required
                        className={inputClass}
                        type="number"
                        min="0.1"
                        max="24"
                        step="0.1"
                        value={resource.dailyHours}
                        onChange={(event) =>
                          setResources((current) =>
                            current.map((item) =>
                              item.id === resource.id
                                ? { ...item, dailyHours: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="text-xs">
                      Date capacity overrides
                      <textarea
                        className={inputClass}
                        rows={3}
                        value={resource.exceptions}
                        placeholder={
                          "YYYY-MM-DD=0 for leave\nYYYY-MM-DD=3 for a partially booked day"
                        }
                        onChange={(event) =>
                          setResources((current) =>
                            current.map((item) =>
                              item.id === resource.id
                                ? { ...item, exceptions: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            <p className="text-xs leading-5 text-[var(--muted)]">
              Enter capacity remaining after other commitments. Company holidays
              and days off reduce available hours. External calendars are not
              connected; update these inputs when availability changes.
            </p>
            <button className="rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">
              {busy
                ? "Planning…"
                : schedule
                  ? "Recalculate delivery dates"
                  : "Calculate delivery dates"}
            </button>
          </fieldset>
        </form>
      </details>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {schedule && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {["Task", "Assigned member", "Start", "Finish"].map((label) => (
                  <th className="p-2 text-xs text-[var(--muted)]" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.tasks.map((task) => (
                <tr className="border-t border-[var(--line)]" key={task.id}>
                  <td className="p-2">
                    {work.find((item) => item.id === task.id)?.title ?? task.id}
                  </td>
                  <td className="p-2">
                    {members.find((member) => member.id === task.assigneeId)
                      ?.label ?? "External"}
                  </td>
                  <td className="whitespace-nowrap p-2">{task.startDate}</td>
                  <td className="whitespace-nowrap p-2">{task.endDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
