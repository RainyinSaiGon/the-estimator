import assert from "node:assert/strict";
import test from "node:test";
import {
  planDeliverySchedule,
  validScheduleDate,
} from "../lib/delivery-schedule.ts";

const work = [
  { id: "a", title: "Import", owner: "company", hours: 8 },
  { id: "b", title: "Reconcile", owner: "company", hours: 6 },
  { id: "c", title: "Review", owner: "company", hours: 6 },
];
function input() {
  return {
    startDate: "2026-10-23",
    workingWeekdays: [1, 2, 3, 4, 5],
    holidays: ["2026-10-26"],
    resources: [
      { id: "alice", dailyHours: 6, exceptions: { "2026-10-23": 2 } },
      { id: "bob", dailyHours: 6, exceptions: {} },
    ],
    tasks: [
      { id: "a", assigneeId: "alice", dependencyIds: [], notBefore: "" },
      { id: "b", assigneeId: "alice", dependencyIds: [], notBefore: "" },
      { id: "c", assigneeId: "bob", dependencyIds: ["a"], notBefore: "" },
    ],
  };
}

test("capacity, partial booked days, holidays, weekends, and dependencies determine delivery dates", () => {
  const plan = planDeliverySchedule(input(), work);
  assert.deepEqual(
    plan.tasks.map((task) => [task.startDate, task.endDate]),
    [
      ["2026-10-23", "2026-10-27"],
      ["2026-10-28", "2026-10-28"],
      ["2026-10-28", "2026-10-28"],
    ],
  );
  assert.equal(plan.finishDate, "2026-10-28");
  assert.deepEqual(
    work.map((task) => task.hours),
    [8, 6, 6],
  );
});
test("external prerequisites require a human ready date and no company resource", () => {
  const source = [
    { id: "external", title: "Client export", owner: "customer", hours: 10 },
    { id: "a", title: "Import", owner: "company", hours: 6 },
  ];
  const data = input();
  data.tasks = [
    {
      id: "external",
      assigneeId: "",
      dependencyIds: [],
      notBefore: "2026-10-29",
    },
    {
      id: "a",
      assigneeId: "alice",
      dependencyIds: ["external"],
      notBefore: "",
    },
  ];
  const plan = planDeliverySchedule(data, source);
  assert.equal(plan.tasks[0].effortHours, 0);
  assert.equal(plan.finishDate, "2026-10-30");
  data.tasks[0].notBefore = "";
  assert.throws(() => planDeliverySchedule(data, source), /ready date/);
});
test("invalid cycles, duplicate work, unknown dependencies, and unavailable capacity are rejected", () => {
  const cyclic = input();
  cyclic.tasks[0].dependencyIds = ["c"];
  assert.throws(() => planDeliverySchedule(cyclic, work), /cycle/);
  const missing = input();
  missing.tasks[0].dependencyIds = ["unknown"];
  assert.throws(() => planDeliverySchedule(missing, work), /Dependencies/);
  const duplicate = input();
  duplicate.tasks[1].id = "a";
  assert.throws(() => planDeliverySchedule(duplicate, work), /exactly once/);
  const noCapacity = input();
  noCapacity.resources[0].dailyHours = 0;
  assert.throws(() => planDeliverySchedule(noCapacity, work), /daily capacity/);
  assert.throws(
    () =>
      planDeliverySchedule(input(), [
        { ...work[0], hours: 1000000 },
        work[1],
        work[2],
      ]),
    /two years/,
  );
});
test("invalid calendar dates, numeric values, and duplicate weekdays cannot enter a plan", () => {
  assert.equal(validScheduleDate("2026-02-30"), false);
  assert.equal(validScheduleDate("2028-02-29"), true);
  const data = input();
  data.resources[0].exceptions["2026-02-30"] = 2;
  assert.throws(() => planDeliverySchedule(data, work), /date overrides/);
  const weekdays = input();
  weekdays.workingWeekdays.push(1);
  assert.throws(() => planDeliverySchedule(weekdays, work), /weekdays/);
  const invalidHours = input();
  invalidHours.resources[0].dailyHours = Infinity;
  assert.throws(() => planDeliverySchedule(invalidHours, work), /capacity/);
});
