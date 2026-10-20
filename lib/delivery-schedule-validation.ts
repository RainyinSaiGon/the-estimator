import { z } from "zod";

export const deliveryScheduleInputSchema = z.object({
  startDate: z.string().length(10),
  workingWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  holidays: z.array(z.string().length(10)).max(730),
  resources: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        dailyHours: z.number().positive().max(24),
        exceptions: z.record(z.string().length(10), z.number().min(0).max(24)),
      }),
    )
    .max(100),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        assigneeId: z.string().max(100),
        dependencyIds: z.array(z.string().min(1).max(100)).max(50),
        notBefore: z.string().max(10),
      }),
    )
    .min(1)
    .max(50),
});
