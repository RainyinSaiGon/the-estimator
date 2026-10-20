export type ScheduleResource = {
  id: string;
  dailyHours: number;
  exceptions: Record<string, number>;
};
export type ScheduleTaskInput = {
  id: string;
  assigneeId: string;
  dependencyIds: string[];
  notBefore: string;
};
export type DeliveryScheduleInput = {
  startDate: string;
  workingWeekdays: number[];
  holidays: string[];
  resources: ScheduleResource[];
  tasks: ScheduleTaskInput[];
};
export type ScheduleWork = {
  id: string;
  title: string;
  hours: number;
  owner: string;
};
export type ScheduledTask = {
  id: string;
  assigneeId: string;
  startDate: string;
  endDate: string;
  effortHours: number;
};
export type DeliverySchedule = {
  baselineId: string;
  baselineSha256: string;
  plannedAt: string;
  plannedBy: string;
  input: DeliveryScheduleInput;
  tasks: ScheduledTask[];
  finishDate: string;
};

export function validScheduleDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
function nextDate(value: string): string {
  return new Date(Date.parse(value + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}

/** A deterministic finish-to-start plan. Capacity is declared by a human; no AI dates or external calendar claims. */
export function planDeliverySchedule(
  input: DeliveryScheduleInput,
  work: ScheduleWork[],
): Pick<DeliverySchedule, "tasks" | "finishDate"> {
  if (
    !validScheduleDate(input.startDate) ||
    !input.workingWeekdays.length ||
    input.workingWeekdays.length > 7 ||
    new Set(input.workingWeekdays).size !== input.workingWeekdays.length ||
    input.workingWeekdays.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    )
  )
    throw new Error("Choose a valid start date and working weekdays.");
  if (
    !work.length ||
    work.length > 50 ||
    new Set(work.map((task) => task.id)).size !== work.length ||
    work.some((task) => !Number.isFinite(task.hours) || task.hours < 0)
  )
    throw new Error("Schedule work must come from a valid frozen baseline.");
  if (
    input.holidays.length > 730 ||
    input.holidays.some((day) => !validScheduleDate(day))
  )
    throw new Error("Enter valid holiday dates.");
  if (
    input.resources.length > 100 ||
    new Set(input.resources.map((resource) => resource.id)).size !==
      input.resources.length ||
    input.resources.some(
      (resource) =>
        !resource.id ||
        !Number.isFinite(resource.dailyHours) ||
        resource.dailyHours <= 0 ||
        resource.dailyHours > 24 ||
        Object.keys(resource.exceptions).length > 730 ||
        Object.entries(resource.exceptions).some(
          ([date, hours]) =>
            !validScheduleDate(date) ||
            !Number.isFinite(hours) ||
            hours < 0 ||
            hours > 24,
        ),
    )
  )
    throw new Error(
      "Each member needs unique, valid daily capacity and date overrides between 0 and 24 hours.",
    );
  const byId = new Map(input.tasks.map((task) => [task.id, task]));
  if (
    input.tasks.length !== work.length ||
    byId.size !== work.length ||
    work.some((task) => !byId.has(task.id))
  )
    throw new Error(
      "Include each frozen work package exactly once in the schedule.",
    );
  const resources = new Map(
    input.resources.map((resource) => [resource.id, resource]),
  );
  const workIds = new Set(work.map((task) => task.id));
  for (const task of input.tasks) {
    if (
      task.dependencyIds.length > 50 ||
      new Set(task.dependencyIds).size !== task.dependencyIds.length ||
      task.dependencyIds.some((id) => id === task.id || !workIds.has(id)) ||
      (task.notBefore && !validScheduleDate(task.notBefore))
    )
      throw new Error(
        "Dependencies must reference other frozen tasks and ready dates must be valid.",
      );
    const source = work.find((item) => item.id === task.id)!;
    if (
      source.owner === "company"
        ? !resources.has(task.assigneeId)
        : !!task.assigneeId || !task.notBefore
    )
      throw new Error(
        "Assign company tasks to an available member and provide a ready date for every external prerequisite.",
      );
  }
  const holidays = new Set(input.holidays);
  const usage = new Map<string, number>();
  const scheduled = new Map<string, ScheduledTask>();
  let pending = [...work];
  const horizon = Date.parse(input.startDate + "T00:00:00Z") + 730 * 86400000;
  while (pending.length) {
    const ready = pending.find((task) =>
      byId.get(task.id)!.dependencyIds.every((id) => scheduled.has(id)),
    );
    if (!ready)
      throw new Error(
        "The task dependencies contain a cycle. Remove it before planning dates.",
      );
    pending = pending.filter((task) => task.id !== ready.id);
    const task = byId.get(ready.id)!;
    let date = [
      input.startDate,
      task.notBefore,
      ...task.dependencyIds.map((id) => nextDate(scheduled.get(id)!.endDate)),
    ]
      .filter(Boolean)
      .sort()
      .at(-1)!;
    let remaining = ready.owner === "company" ? ready.hours : 0;
    let startDate = "";
    if (ready.owner === "company") {
      const resource = resources.get(task.assigneeId)!;
      for (;;) {
        if (Date.parse(date + "T00:00:00Z") > horizon)
          throw new Error(
            "The declared capacity cannot finish this plan within two years. Review hours, staffing, and dependencies.",
          );
        const weekday = new Date(date + "T00:00:00Z").getUTCDay();
        const key = `${resource.id}:${date}`;
        const capacity =
          holidays.has(date) || !input.workingWeekdays.includes(weekday)
            ? 0
            : (resource.exceptions[date] ?? resource.dailyHours);
        const available = Math.max(0, capacity - (usage.get(key) ?? 0));
        if (available > 0) {
          startDate ||= date;
          const allocated = Math.min(remaining, available);
          usage.set(key, (usage.get(key) ?? 0) + allocated);
          remaining -= allocated;
          if (remaining < 0.000001) break;
        }
        date = nextDate(date);
      }
    } else {
      if (Date.parse(date + "T00:00:00Z") > horizon)
        throw new Error(
          "External ready dates must fall within two years of the plan start.",
        );
      startDate = date;
    }
    scheduled.set(ready.id, {
      id: ready.id,
      assigneeId: task.assigneeId,
      startDate,
      endDate: date,
      effortHours: ready.owner === "company" ? ready.hours : 0,
    });
  }
  return {
    tasks: work.map((task) => scheduled.get(task.id)!),
    finishDate: [...scheduled.values()]
      .map((task) => task.endDate)
      .sort()
      .at(-1)!,
  };
}
