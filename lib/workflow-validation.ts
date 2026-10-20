import { z } from "zod";
import { requestTypes } from "./client-workflow-types";
import { deliveryScheduleInputSchema } from "./delivery-schedule-validation";
import { BROWSER_DOCUMENT_UPLOAD_POLICY, DOCUMENT_EXTRACTION_LIMITS, DOCUMENT_EXTRACTION_STATUSES } from "./document-extraction-policy";

const requestTypeSchema = z.enum(requestTypes);

const complexitySchema = z.enum(["low", "medium", "high"]);

const ownerSchema = z.enum(["company", "customer", "vendor"]);

const taskIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

const taskTemplateSchema = z.object({
  id: taskIdSchema,
  label: z.string().trim().min(1).max(100),
  baseHours: z.number().min(0.1).max(10000),
  lowFactor: z.number().min(0.1).max(1),
  highFactor: z.number().min(1).max(5),
});

const productSchema = z.object({
  id: taskIdSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
});

const fieldSchema = z.object({
  key: taskIdSchema,
  label: z.string().trim().min(1).max(100),
  requestTypes: z.array(requestTypeSchema).max(6),
  required: z.boolean(),
  priority: z.number().int().min(1).max(10).optional(),
});

const workPackageSchema = z.object({
  id: z.string().uuid(),
  taskId: taskIdSchema,
  title: z.string().trim().min(1).max(160),
  quantity: z.number().min(0.1).max(100),
  complexity: complexitySchema,
  owner: ownerSchema,
  acceptance: z.string().max(1200),
  dependencies: z.string().max(1200),
  rationale: z.string().max(1200).optional(),
  evidence: z.string().max(1000).optional(),
  evidenceSource: z.string().max(200).optional(),
});

const reviewSchema = z.object({
  requestType: requestTypeSchema,
  productId: z.string().max(80),
  deliverables: z.string().max(5000),
  exclusions: z.string().max(3000),
  acceptance: z.string().max(3000),
  dependencies: z.string().max(3000),
  questions: z.array(z.string().max(500)).max(20),
  questionResolutions: z
    .record(
      z.string(),
      z.object({
        disposition: z.enum(["answered", "not_applicable"]).optional(),
        resolution: z.string().max(1000).default(""),
        question: z.string().max(500).optional(),
      }),
    )
    .default({}),
  findingReviews: z
    .record(
      z.string(),
      z.object({
        disposition: z.enum(["accepted", "corrected", "rejected"]),
        correction: z.string().max(2000).default(""),
      }),
    )
    .default({}),
  workPackages: z.array(workPackageSchema).max(20),
  domain: z.string().trim().max(100).default(""),
  fieldAnswers: z.record(z.string().max(2000)).default({}),
  sourceLimitationsAcknowledged: z.boolean().default(false),
});

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveSchedule"), companyId: z.string().uuid(), requestId: z.string().uuid(), expectedVersion: z.number().int().positive(), schedule: deliveryScheduleInputSchema }),
  z.object({ action: z.literal("applySchedule"), companyId: z.string().uuid(), requestId: z.string().uuid(), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("reviewScopeChange"), companyId: z.string().uuid(), requestId: z.string().uuid(), expectedVersion: z.number().int().positive(), changeId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), notes: z.string().trim().min(10).max(2000) }),
  z.object({ action: z.literal("createCompany"), name: z.string().trim().min(2).max(120) }),
  z.object({
    action: z.literal("createRequest"),
    requestId: z.string().uuid().optional(),
    uploadVerified: z.literal(true).optional(),
    companyId: z.string().uuid(),
    title: z.string().trim().min(3).max(200),
    cohort: z.enum(["synthetic", "recorded"]).default("recorded"),
    text: z.string().trim().max(20000).default(""),
    attachments: z
      .array(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).max(DOCUMENT_EXTRACTION_LIMITS.fileNameCharacters),
          type: z.string().min(1).max(16),
          size: z
            .number()
            .int()
            .positive()
            .max(BROWSER_DOCUMENT_UPLOAD_POLICY.maxFileBytes),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          text: z.string().max(DOCUMENT_EXTRACTION_LIMITS.textCharacters),
          status: z.enum(DOCUMENT_EXTRACTION_STATUSES),
          message: z.string().max(1000).optional(),
          locators: z.array(z.string().max(DOCUMENT_EXTRACTION_LIMITS.locatorCharacters)).max(DOCUMENT_EXTRACTION_LIMITS.locators),
          truncated: z.boolean(),
          objectKey: z.string().min(1).max(500),
        }),
      )
      .max(BROWSER_DOCUMENT_UPLOAD_POLICY.maxFiles)
      .default([]),
  }),
  z.object({
    action: z.literal("analyze"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("saveReview"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    review: reviewSchema,
  }),
  z.object({
    action: z.literal("confirmScope"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("estimate"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("freeze"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("saveTracking"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    taskTracking: z
      .array(
        z.object({
          workPackageId: z.string().uuid(),
          status: z.enum(["not_started", "in_progress", "blocked", "complete"]),
          assignee: z.string().max(100),
          plannedStart: z.string().max(10),
          plannedEnd: z.string().max(10),
          blocker: z.string().max(1000),
          milestones: z
            .array(
              z.object({
                id: z.string().uuid(),
                title: z.string().trim().min(1).max(160),
                dueDate: z.string().max(10),
                status: z.enum(["pending", "complete"]),
              }),
            )
            .max(20),
        }),
      )
      .max(20),
    scopeChange: z
      .object({
        description: z.string().trim().min(3).max(1000),
        reason: z.string().trim().min(3).max(1000),
        effortImpact: z.string().trim().min(3).max(500),
      })
      .optional(),
  }),
  z.object({
    action: z.literal("deleteRequest"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("saveConfiguration"),
    companyId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    config: z.object({
      taskSizeGuidelineHours: z.number().min(1).max(10000).optional(),
      fields: z.array(fieldSchema).max(40),
      products: z.array(productSchema).max(30),
      capabilities: z.array(z.string().trim().min(1).max(120)).max(60),
      tasks: z.array(taskTemplateSchema).min(1).max(30),
    }),
  }),
  z.object({
    action: z.literal("addKnowledge"),
    companyId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(2).max(200),
    url: z
      .string()
      .url()
      .max(2000)
      .refine((value) => /^https:\/\//i.test(value), "Source URLs must use HTTPS.")
      .or(z.literal("")),
    text: z.string().trim().min(30).max(100000),
  }),
  z.object({
    action: z.literal("approveKnowledge"),
    companyId: z.string().uuid(),
    knowledgeId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("retireKnowledge"),
    companyId: z.string().uuid(),
    knowledgeId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("setMember"),
    companyId: z.string().uuid(),
    userId: z.string().trim().min(3).max(200),
    displayName: z.string().trim().min(1).max(100),
    role: z.enum(["admin", "estimator", "reviewer", "viewer"]),
  }),
  z.object({
    action: z.literal("removeMember"),
    companyId: z.string().uuid(),
    userId: z.string().trim().min(3).max(200),
  }),
  z.object({
    action: z.literal("rotateCredential"),
    companyId: z.string().uuid(),
    kind: z.enum(["webhook", "mcp"]),
  }),
  z.object({
    action: z.literal("revokeCredential"),
    companyId: z.string().uuid(),
    kind: z.enum(["webhook", "mcp"]),
  }),
  z.object({
    action: z.literal("submitDelivery"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    actualHours: z.record(z.number().min(0).max(100000)),
    addedScopeHours: z.number().min(0).max(100000),
    evidence: z.string().trim().min(20).max(5000),
    deliveredAt: z.string().datetime(),
    reviewerId: z.string().min(3).max(200),
    originalScopeOnly: z.literal(true),
  }),
  z.object({
    action: z.literal("reviewDelivery"),
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    outcomeId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    notes: z.string().trim().min(20).max(3000),
    evidenceInspected: z.literal(true),
  }),
]);

export const analysisSchema = z.object({
  summary: z.string().min(1).max(2000),
  requestType: requestTypeSchema,
  productId: z.string().max(80),
  facts: z
    .array(
      z.object({
        key: z.string().max(100),
        value: z.string().max(1000),
        source: z.string().max(200),
        evidence: z.string().max(2000),
        status: z.enum(["source", "inference"]),
      }),
    )
    .max(40),
  capabilityFindings: z
    .array(
      z.object({
        capability: z.string().max(120),
        status: z.enum(["supported", "gap", "unknown"]),
        evidence: z.string().max(2000),
        explanation: z.string().max(1000),
      }),
    )
    .max(30),
  productFindings: z
    .array(
      z.object({
        productId: z.string().max(80),
        status: z.enum(["fit", "gap", "unknown"]),
        explanation: z.string().max(1000),
        sourceId: z.string().max(80),
        evidence: z.string().max(2000),
      }),
    )
    .max(30),
  assumptions: z.array(z.string().max(1000)).max(20),
  conflicts: z.array(z.string().max(1000)).max(20),
  questions: z.array(z.string().max(500)).max(20),
  deliverables: z.string().max(5000),
  exclusions: z.string().max(3000),
  acceptance: z.string().max(3000),
  dependencies: z.string().max(3000),
  workPackages: z
    .array(
      z.object({
        id: z.string().max(100),
        taskId: taskIdSchema,
        title: z.string().max(160),
        quantity: z.number().min(0.1).max(100),
        complexity: complexitySchema,
        owner: ownerSchema,
        acceptance: z.string().max(1200),
        dependencies: z.string().max(1200),
        rationale: z.string().max(1200),
        evidence: z.string().max(1000),
      }),
    )
    .max(20),
  sourceCheck: z.string().max(1000),
});
