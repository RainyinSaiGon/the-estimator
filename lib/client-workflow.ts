import { env } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { workflowCompanies, workflowRequests } from "../db/schema";
import { aiConfig } from "./brief-ai";
import { type ClientRequest, type Company, type WorkspaceResponse } from "./client-workflow-types";
import { PUBLIC_DEMO_ACTOR_ID } from "./public-demo-access";
import { requestMaterial, reviewFromAnalysis, runAI } from "./workflow-analysis";
import { defaultConfig } from "./workflow-defaults";
import { ClientWorkflowError } from "./workflow-errors";
import { declareDeliverySplit, evaluateDeliveries } from "./workflow-evaluation";
import {
  accessibleCompanyIds,
  auditStatement,
  companyRole,
  governanceStatements,
  governanceView,
  protectCredential,
  requireCompanyRole,
  textDigest,
  workflowDb,
} from "./workflow-governance";
import {
  ensureWorkflowKnowledgeSchema,
  readKnowledgeFetchMetadata,
} from "./workflow-knowledge-store";
import { makeEstimate, scopeReadinessBlockers } from "./workflow-planning";
import { actionSchema } from "./workflow-validation";
export { ClientWorkflowError } from "./workflow-errors";

let workflowSchemaReady: Promise<void> | undefined;
export function ensureClientWorkflowSchema() {
  if (!env.DB)
    throw new ClientWorkflowError(
      "Company storage is not ready. The Site D1 binding is missing.",
      503,
    );
  workflowSchemaReady ??= (async () => {
    const statements = [
      "CREATE TABLE IF NOT EXISTS workflow_companies (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS workflow_companies_owner_updated ON workflow_companies (owner_id, updated_at)",
      "CREATE TABLE IF NOT EXISTS workflow_requests (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, company_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS workflow_requests_owner_company_updated ON workflow_requests (owner_id, company_id, updated_at)",
      "CREATE INDEX IF NOT EXISTS workflow_requests_company_status ON workflow_requests (company_id, status)",
      ...governanceStatements,
    ];
    try {
      for (const statement of statements) await env.DB!.prepare(statement).run();
    } catch (error) {
      workflowSchemaReady = undefined;
      throw error;
    }
  })();
  return workflowSchemaReady;
}

function parseCompany(row: typeof workflowCompanies.$inferSelect): Company {
  const data = JSON.parse(row.payload) as Omit<Company, "id" | "name" | "version" | "role">;
  return {
    ...data,
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    version: row.version,
    role: "admin",
    requests: [],
    members: [],
    connectors: { webhookConfigured: false, mcpConfigured: false, encryptionReady: false },
    audit: [],
    evaluation: evaluateDeliveries([]),
  };
}
function parseRequest(row: typeof workflowRequests.$inferSelect): ClientRequest {
  const request = JSON.parse(row.payload) as ClientRequest;
  return { ...request, attachments: request.attachments ?? [] };
}
function publicRequest(request: ClientRequest): ClientRequest {
  const safeRequest = structuredClone(request);
  for (const attachment of safeRequest.attachments) delete attachment.objectKey;
  return safeRequest;
}
export async function getWorkspace(
  actorId: string,
  companyId?: string,
): Promise<WorkspaceResponse> {
  const db = getDb();
  const ids = await accessibleCompanyIds(actorId);
  const companies = ids.length
    ? await db
        .select()
        .from(workflowCompanies)
        .where(inArray(workflowCompanies.id, ids))
        .orderBy(desc(workflowCompanies.updatedAt))
        .limit(50)
    : [];
  const selected = companyId ? companies.find((row) => row.id === companyId) : companies[0];
  const requests = selected
    ? await db
        .select()
        .from(workflowRequests)
        .where(eq(workflowRequests.companyId, selected.id))
        .orderBy(desc(workflowRequests.updatedAt))
        .limit(200)
    : [];
  const roles = await Promise.all(companies.map((row) => companyRole(row.id, actorId)));
  const summary = await Promise.all(
    companies.map(async (row, index) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      role: roles[index]!,
      requestCount:
        (
          await workflowDb()
            .prepare("SELECT COUNT(*) AS n FROM workflow_requests WHERE company_id = ?")
            .bind(row.id)
            .first<{ n: number }>()
        )?.n ?? 0,
    })),
  );
  const publicRequests = requests.map(parseRequest).map(publicRequest);
  const knowledgeMetadata = selected
    ? (await ensureWorkflowKnowledgeSchema(), await readKnowledgeFetchMetadata(selected.id))
    : {};
  const selectedCompany = selected ? parseCompany(selected) : undefined;
  if (selectedCompany)
    selectedCompany.knowledge = selectedCompany.knowledge.map((source) => ({
      ...source,
      ...(knowledgeMetadata[source.id]
        ? {
            retrievedAt: knowledgeMetadata[source.id]!.retrievedAt,
            contentType: knowledgeMetadata[source.id]!.contentType,
            truncated: knowledgeMetadata[source.id]!.truncated,
          }
        : {}),
    }));
  return {
    companies: summary,
    actorId,
    aiReady: Boolean(aiConfig().key),
    ...(selected && selectedCompany
      ? {
          company: {
            ...selectedCompany,
            role: roles[companies.findIndex((row) => row.id === selected.id)]!,
            ...(await governanceView(selected.id, selected.ownerId)),
            requests: publicRequests,
            evaluation: evaluateDeliveries(publicRequests),
          },
        }
      : {}),
  };
}

async function ownedCompany(ownerId: string, companyId: string): Promise<Company> {
  const role = await companyRole(companyId, ownerId);
  if (!role) throw new ClientWorkflowError("Company workspace not found.", 404);
  await ensureWorkflowKnowledgeSchema();
  const [row] = await getDb()
    .select()
    .from(workflowCompanies)
    .where(eq(workflowCompanies.id, companyId))
    .limit(1);
  const company = parseCompany(row);
  const metadata = await readKnowledgeFetchMetadata(companyId);
  company.knowledge = company.knowledge.map((source) => ({
    ...source,
    ...(metadata[source.id]
      ? {
          retrievedAt: metadata[source.id]!.retrievedAt,
          contentType: metadata[source.id]!.contentType,
          truncated: metadata[source.id]!.truncated,
        }
      : {}),
  }));
  return { ...company, role, ...(await governanceView(companyId, row.ownerId)) };
}
async function ownedRequest(
  ownerId: string,
  companyId: string,
  requestId: string,
  expectedVersion?: number,
) {
  await ownedCompany(ownerId, companyId);
  const [row] = await getDb()
    .select()
    .from(workflowRequests)
    .where(and(eq(workflowRequests.id, requestId), eq(workflowRequests.companyId, companyId)))
    .limit(1);
  if (!row) throw new ClientWorkflowError("Request not found.", 404);
  if (expectedVersion !== undefined && row.version !== expectedVersion)
    throw new ClientWorkflowError(
      "This request changed in another session. Refresh before saving.",
      409,
    );
  return { row, request: parseRequest(row) };
}
async function saveRequest(
  ownerId: string,
  request: ClientRequest,
  expectedVersion: number,
  companyId: string,
  actorId: string,
  action: string,
) {
  const db = workflowDb();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE workflow_requests SET title = ?, status = ?, version = ?, payload = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND company_id = ? AND version = ?",
      )
      .bind(
        request.title,
        request.status,
        request.version,
        JSON.stringify(request),
        request.updatedAt,
        request.id,
        ownerId,
        companyId,
        expectedVersion,
      ),
    db
      .prepare(
        "INSERT INTO workflow_audit (id, company_id, request_id, actor, action, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1",
      )
      .bind(crypto.randomUUID(), companyId, request.id, actorId, action, request.updatedAt),
  ]);
  if (result[0].meta.changes !== 1)
    throw new ClientWorkflowError("This request changed while saving. Refresh and retry.", 409);
}
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function applyAction(
  actorId: string,
  userName: string,
  raw: unknown,
  inbound?: { submissionId: string; payloadDigest: string },
): Promise<WorkspaceResponse> {
  const input = actionSchema.parse(raw);
  const db = getDb();
  const at = new Date().toISOString();
  if (input.action === "createCompany") {
    const count = await workflowDb()
      .prepare("SELECT COUNT(*) AS n FROM workflow_companies WHERE owner_id = ?")
      .bind(actorId)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= 50)
      throw new ClientWorkflowError("This account supports at most 50 company workspaces.");
    const id = crypto.randomUUID();
    const company = { id, name: input.name, version: 1, config: defaultConfig(), knowledge: [] };
    await db.insert(workflowCompanies).values({
      id,
      ownerId: actorId,
      name: input.name,
      version: company.version,
      payload: JSON.stringify({ config: company.config, knowledge: company.knowledge }),
      createdAt: at,
      updatedAt: at,
    });
    await auditStatement(id, actorId, "company.created").run();
    return getWorkspace(actorId, id);
  }
  const company = await ownedCompany(actorId, input.companyId);
  const ownerId = company.ownerId;
  const adminActions = [
    "saveConfiguration",
    "addKnowledge",
    "approveKnowledge",
    "retireKnowledge",
    "setMember",
    "removeMember",
    "rotateCredential",
    "revokeCredential",
  ];
  requireCompanyRole(
    company.role,
    adminActions.includes(input.action)
      ? ["admin"]
      : input.action === "reviewDelivery"
        ? ["admin", "reviewer"]
        : ["admin", "estimator"],
  );
  if (input.action === "setMember" || input.action === "removeMember") {
    if (input.userId === ownerId)
      throw new ClientWorkflowError("The workspace owner's administrator role cannot be changed.");
    if (
      input.action === "setMember" &&
      company.members.length >= 100 &&
      !company.members.some((member) => member.userId === input.userId)
    )
      throw new ClientWorkflowError("This workspace supports at most 100 members.");
    await workflowDb().batch([
      input.action === "setMember"
        ? workflowDb()
            .prepare(
              "INSERT INTO workflow_members (company_id, user_id, display_name, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, user_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role",
            )
            .bind(company.id, input.userId, input.displayName, input.role, at)
        : workflowDb()
            .prepare("DELETE FROM workflow_members WHERE company_id = ? AND user_id = ?")
            .bind(company.id, input.userId),
      auditStatement(
        company.id,
        actorId,
        input.action === "setMember"
          ? `member.set:${input.userId}:${input.role}`
          : `member.removed:${input.userId}`,
      ),
    ]);
    return getWorkspace(actorId, company.id);
  }
  if (input.action === "rotateCredential" || input.action === "revokeCredential") {
    if (input.action === "revokeCredential") {
      await workflowDb().batch([
        workflowDb()
          .prepare("DELETE FROM workflow_credentials WHERE company_id = ? AND kind = ?")
          .bind(company.id, input.kind),
        auditStatement(company.id, actorId, `${input.kind}.revoked`),
      ]);
      return getWorkspace(actorId, company.id);
    }
    const token = `est_${input.kind}_${[...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const verifier =
      input.kind === "webhook"
        ? await protectCredential(token, company.id)
        : await textDigest(token);
    await workflowDb().batch([
      workflowDb()
        .prepare(
          "INSERT INTO workflow_credentials (company_id, kind, verifier, issued_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, kind) DO UPDATE SET verifier = excluded.verifier, issued_by = excluded.issued_by, created_at = excluded.created_at",
        )
        .bind(company.id, input.kind, verifier, actorId, at),
      auditStatement(company.id, actorId, `${input.kind}.rotated`),
    ]);
    return {
      ...(await getWorkspace(actorId, company.id)),
      issuedCredential: { kind: input.kind, value: token },
    };
  }
  if (input.action === "saveConfiguration") {
    if (company.version !== input.expectedVersion)
      throw new ClientWorkflowError(
        "Company settings changed in another session. Refresh before saving.",
        409,
      );
    for (const [kind, keys] of [
      ["Task template", input.config.tasks.map((item) => item.id)],
      ["Product", input.config.products.map((item) => item.id)],
      ["Field", input.config.fields.map((item) => item.key)],
    ] as const) {
      if (new Set(keys).size !== keys.length)
        throw new ClientWorkflowError(`${kind} IDs must be unique.`);
    }
    const updatedConfig = { ...input.config, version: company.config.version + 1 };
    const result = await db
      .update(workflowCompanies)
      .set({
        name: company.name,
        version: company.version + 1,
        payload: JSON.stringify({ config: updatedConfig, knowledge: company.knowledge }),
        updatedAt: at,
      })
      .where(
        and(
          eq(workflowCompanies.id, company.id),
          eq(workflowCompanies.ownerId, ownerId),
          eq(workflowCompanies.version, company.version),
        ),
      )
      .returning({ id: workflowCompanies.id });
    if (!result.length)
      throw new ClientWorkflowError(
        "Company settings changed while saving. Refresh and retry.",
        409,
      );
    await auditStatement(
      company.id,
      actorId,
      `configuration.saved:v${updatedConfig.version}`,
    ).run();
    return getWorkspace(actorId, company.id);
  }
  if (
    input.action === "addKnowledge" ||
    input.action === "approveKnowledge" ||
    input.action === "retireKnowledge"
  ) {
    const expectedVersion = input.expectedVersion;
    if (company.version !== expectedVersion)
      throw new ClientWorkflowError(
        "Company knowledge changed in another session. Refresh before saving.",
        409,
      );
    const knowledge = [...company.knowledge];
    if (input.action === "addKnowledge") {
      if (knowledge.length >= 200)
        throw new ClientWorkflowError("This workspace supports at most 200 knowledge versions.");
      const source = {
        id: crypto.randomUUID(),
        title: input.title,
        url: input.url,
        text: input.text,
        status: "draft" as const,
        sha256: await digest(input.text),
        addedAt: at,
      };
      knowledge.push(source);
    } else {
      const index = knowledge.findIndex((item) => item.id === input.knowledgeId);
      if (index < 0) throw new ClientWorkflowError("Knowledge source not found.", 404);
      const item = knowledge[index];
      if (input.action === "approveKnowledge") {
        knowledge[index] = { ...item, status: "approved", approvedAt: at, approvedBy: userName };
      } else {
        knowledge[index] = { ...item, status: "retired" };
      }
    }
    const updated = await db
      .update(workflowCompanies)
      .set({
        version: company.version + 1,
        payload: JSON.stringify({ config: company.config, knowledge }),
        updatedAt: at,
      })
      .where(
        and(
          eq(workflowCompanies.id, company.id),
          eq(workflowCompanies.ownerId, ownerId),
          eq(workflowCompanies.version, company.version),
        ),
      )
      .returning({ id: workflowCompanies.id });
    if (!updated.length)
      throw new ClientWorkflowError(
        "Company knowledge changed while saving. Refresh and retry.",
        409,
      );
    await auditStatement(company.id, actorId, input.action).run();
    return getWorkspace(actorId, company.id);
  }
  if (input.action === "createRequest") {
    const intakeActor = inbound ? `webhook:${company.id}` : actorId;
    const count = await workflowDb()
      .prepare("SELECT COUNT(*) AS n FROM workflow_requests WHERE company_id = ?")
      .bind(company.id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= 200)
      throw new ClientWorkflowError(
        "This workspace supports at most 200 requests. Export and archive delivery records before adding more.",
      );
    if (input.attachments.length && !input.uploadVerified)
      throw new ClientWorkflowError(
        "Request files must be uploaded through the private file intake route.",
        400,
      );
    if (input.text.length < 30 && input.attachments.length === 0)
      throw new ClientWorkflowError(
        "Paste at least 30 characters or attach a document to receive the request.",
      );
    // Cohort policy belongs to the company owner, not the submitting member or intake channel.
    const cohort = ownerId === PUBLIC_DEMO_ACTOR_ID ? "synthetic" : input.cohort;
    const request: ClientRequest = {
      id: input.requestId ?? crypto.randomUUID(),
      title: input.title,
      text: input.text,
      attachments: input.attachments,
      channel: inbound ? "webhook" : "manual",
      cohort,
      createdBy: intakeActor,
      delivery: [],
      createdAt: at,
      updatedAt: at,
      status: "received",
      version: 1,
      review: {
        requestType: "demo",
        productId: "",
        deliverables: "",
        exclusions: "",
        acceptance: "",
        dependencies: "",
        questions: [],
        workPackages: [],
        confirmed: false,
        confirmedBy: "",
        domain: "",
        fieldAnswers: {},
      },
      baselines: [],
    };
    const statements = [
      workflowDb()
        .prepare(
          "INSERT INTO workflow_requests (id, owner_id, company_id, title, status, version, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          request.id,
          ownerId,
          company.id,
          request.title,
          request.status,
          request.version,
          JSON.stringify(request),
          at,
          at,
        ),
      auditStatement(company.id, intakeActor, "request.received", request.id),
    ];
    if (inbound)
      statements.unshift(
        workflowDb()
          .prepare(
            "INSERT INTO workflow_inbound (company_id, submission_id, payload_digest, request_id, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(company.id, inbound.submissionId, inbound.payloadDigest, request.id, at),
      );
    await workflowDb().batch(statements);
    try {
      const material = [
        input.text ? `[Source: Client message]\n${input.text}` : "",
        ...input.attachments.map((file) =>
          file.text
            ? `[Source file: ${file.name}; type: ${file.type}; references: ${file.locators.join(", ")}]\n${file.text}`
            : `[Source file: ${file.name}; extraction status: ${file.status}; ${file.message ?? "No extracted text."}]`,
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
      const analysis = await runAI(material, company);
      request.analysis = analysis;
      request.review = reviewFromAnalysis(analysis);
      request.status = "needs_review";
      request.version += 1;
      request.updatedAt = new Date().toISOString();
      await saveRequest(ownerId, request, 1, company.id, intakeActor, "request.analysis_finished");
    } catch (error) {
      request.status = "analysis_failed";
      request.analysisError = error instanceof Error ? error.message : "AI analysis failed.";
      request.version += 1;
      request.updatedAt = new Date().toISOString();
      await saveRequest(ownerId, request, 1, company.id, intakeActor, "request.analysis_finished");
    }
    return getWorkspace(actorId, company.id);
  }
  const { request, row } = await ownedRequest(
    actorId,
    company.id,
    input.requestId,
    input.expectedVersion,
  );
  const expectedVersion = row.version;
  if (input.action === "submitDelivery" || input.action === "reviewDelivery") {
    if (request.status !== "frozen")
      throw new ClientWorkflowError(
        "Freeze a reviewed baseline before recording delivery actuals.",
      );
    const baseline = request.baselines.at(-1);
    if (!baseline?.evaluation)
      throw new ClientWorkflowError(
        "This legacy baseline has no declared evaluation split. It cannot accept evaluation-eligible actuals.",
      );
    const outcomes = [...(request.delivery ?? [])];
    if (input.action === "submitDelivery") {
      const expectedIds = baseline.review.workPackages.map((item) => item.id);
      if (
        !expectedIds.length ||
        Object.keys(input.actualHours).length !== expectedIds.length ||
        expectedIds.some((id) => !(id in input.actualHours)) ||
        Object.values(input.actualHours).reduce((sum, hours) => sum + hours, 0) <= 0
      )
        throw new ClientWorkflowError(
          "Enter original-scope actual hours for exactly the frozen work packages, with a positive total.",
        );
      if (outcomes.some((outcome) => outcome.status !== "rejected"))
        throw new ClientWorkflowError(
          "This baseline already has pending or approved actuals. Review the existing submission.",
        );
      const reviewer = company.members.find((member) => member.userId === input.reviewerId);
      if (
        input.reviewerId === actorId ||
        !reviewer ||
        !["admin", "reviewer"].includes(reviewer.role)
      )
        throw new ClientWorkflowError(
          "Choose a different authorized reviewer for delivery approval.",
        );
      if (input.deliveredAt < baseline.createdAt || input.deliveredAt > at)
        throw new ClientWorkflowError(
          "Delivery must occur after the baseline was frozen and no later than now.",
        );
      outcomes.push({
        id: crypto.randomUUID(),
        baselineId: baseline.id,
        baselineSha256: baseline.sha256,
        actualHours: input.actualHours,
        originalHours: Object.values(input.actualHours).reduce((sum, hours) => sum + hours, 0),
        addedScopeHours: input.addedScopeHours,
        evidence: input.evidence,
        submittedBy: actorId,
        submittedName: userName,
        submittedAt: at,
        deliveredAt: input.deliveredAt,
        reviewerId: input.reviewerId,
        status: "pending",
      });
    } else {
      const index = outcomes.findIndex((outcome) => outcome.id === input.outcomeId);
      const outcome = outcomes[index];
      if (!outcome || outcome.status !== "pending")
        throw new ClientWorkflowError(
          "This delivery submission is no longer awaiting review.",
          409,
        );
      if (outcome.submittedBy === actorId || outcome.reviewerId !== actorId)
        throw new ClientWorkflowError(
          "Only the designated independent reviewer may approve or reject these actuals.",
          403,
        );
      outcomes[index] = {
        ...outcome,
        status: input.decision,
        reviewedBy: actorId,
        reviewedName: userName,
        reviewedAt: at,
        reviewNotes: input.notes,
      };
    }
    request.delivery = outcomes;
    request.version++;
    request.updatedAt = at;
    await saveRequest(
      ownerId,
      request,
      expectedVersion,
      company.id,
      actorId,
      input.action === "submitDelivery" ? "delivery.submitted" : `delivery.${input.decision}`,
    );
    return getWorkspace(actorId, company.id);
  }
  if (input.action === "saveTracking") {
    if (request.status !== "frozen")
      throw new ClientWorkflowError(
        "Freeze an approved estimate before tracking commitment tasks.",
      );
    const baseline = request.baselines.at(-1);
    if (!baseline) throw new ClientWorkflowError("This request has no frozen commitment baseline.");
    const expectedIds = baseline.review.workPackages.map((item) => item.id);
    const submittedIds = input.taskTracking.map((item) => item.workPackageId);
    if (
      new Set(submittedIds).size !== submittedIds.length ||
      submittedIds.length !== expectedIds.length ||
      expectedIds.some((id) => !submittedIds.includes(id))
    )
      throw new ClientWorkflowError("Tracking must include each frozen work package exactly once.");
    const validDate = (value: string) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
        new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
    for (const task of input.taskTracking) {
      if (task.assignee && !company.members.some((member) => member.userId === task.assignee))
        throw new ClientWorkflowError("Assign tasks to a member of this company workspace.");
      if (
        !validDate(task.plannedStart) ||
        !validDate(task.plannedEnd) ||
        (task.plannedStart && task.plannedEnd && task.plannedStart > task.plannedEnd)
      )
        throw new ClientWorkflowError(
          "Task planned dates must be valid and the start cannot follow the end.",
        );
      if (task.status === "blocked" && !task.blocker.trim())
        throw new ClientWorkflowError("Add a blocker description for each blocked task.");
      const milestoneIds = task.milestones.map((item) => item.id);
      if (
        new Set(milestoneIds).size !== milestoneIds.length ||
        task.milestones.some((item) => !validDate(item.dueDate))
      )
        throw new ClientWorkflowError("Milestones need unique IDs and valid due dates.");
    }
    const scopeChanges = [...(request.scopeChanges ?? [])];
    if (input.scopeChange) {
      if (scopeChanges.length >= 100)
        throw new ClientWorkflowError(
          "This commitment has reached the 100-entry scope-change limit.",
        );
      scopeChanges.push({
        id: crypto.randomUUID(),
        ...input.scopeChange,
        createdBy: userName,
        createdAt: at,
        status: "proposed",
      });
    }
    request.taskTracking = input.taskTracking;
    request.scopeChanges = scopeChanges;
    request.version++;
    request.updatedAt = at;
    await saveRequest(
      ownerId,
      request,
      expectedVersion,
      company.id,
      actorId,
      input.scopeChange
        ? "commitment.tracking_and_scope_change_saved"
        : "commitment.tracking_saved",
    );
    return getWorkspace(actorId, company.id);
  }
  if (input.action === "deleteRequest") {
    if (request.status === "frozen")
      throw new ClientWorkflowError(
        "Frozen delivery records cannot be deleted through the workspace. Their baseline and audit history are retained.",
      );
    const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
    if (request.attachments.some((file) => file.objectKey) && !bucket)
      throw new ClientWorkflowError(
        "File storage is unavailable. The request was not deleted.",
        503,
      );
    const deleted = await db
      .delete(workflowRequests)
      .where(
        and(
          eq(workflowRequests.id, request.id),
          eq(workflowRequests.ownerId, ownerId),
          eq(workflowRequests.version, expectedVersion),
        ),
      )
      .returning({ id: workflowRequests.id });
    if (!deleted.length)
      throw new ClientWorkflowError("This request changed while deleting. Refresh and retry.", 409);
    if (bucket) {
      const keys = request.attachments
        .map((file) => file.objectKey)
        .filter((key): key is string => Boolean(key));
      if (keys.length) await bucket.delete(keys);
    }
    return getWorkspace(actorId, company.id);
  }
  if (request.status === "frozen")
    throw new ClientWorkflowError(
      "This request has a frozen baseline. Start a new version to change scope.",
    );
  request.version += 1;
  request.updatedAt = at;
  if (input.action === "analyze") {
    request.status = "analyzing";
    request.analysisError = undefined;
    await saveRequest(ownerId, request, expectedVersion, company.id, actorId, input.action);
    try {
      request.analysis = await runAI(requestMaterial(request), company);
      request.review = reviewFromAnalysis(request.analysis);
      request.status = "needs_review";
    } catch (error) {
      request.status = "analysis_failed";
      request.analysisError = error instanceof Error ? error.message : "AI analysis failed.";
    }
    request.version += 1;
    request.updatedAt = new Date().toISOString();
    await saveRequest(
      ownerId,
      request,
      expectedVersion + 1,
      company.id,
      actorId,
      "request.analysis_finished",
    );
  } else if (input.action === "saveReview") {
    if (
      Object.keys(input.review.fieldAnswers).some(
        (key) => !company.config.fields.some((field) => field.key === key),
      )
    )
      throw new ClientWorkflowError("Review answers must use configured field keys.");
    if (
      input.review.productId &&
      !company.config.products.some((product) => product.id === input.review.productId)
    )
      throw new ClientWorkflowError("Select a configured product or leave product fit unknown.");
    request.review = { ...input.review, confirmed: false, confirmedBy: "", confirmedAt: undefined };
    request.estimate = undefined;
    request.status = "needs_review";
    await saveRequest(ownerId, request, expectedVersion, company.id, actorId, input.action);
  } else if (input.action === "confirmScope") {
    const scopeBlockers = scopeReadinessBlockers(request, company);
    if (scopeBlockers.length) throw new ClientWorkflowError(scopeBlockers.join(" "));
    request.review = {
      ...request.review,
      confirmed: true,
      confirmedBy: userName,
      confirmedAt: at,
      confirmedConfigVersion: company.config.version,
      confirmedCompanyVersion: company.version,
    };
    request.estimate = undefined;
    request.status = "scope_confirmed";
    await saveRequest(ownerId, request, expectedVersion, company.id, actorId, input.action);
  } else if (input.action === "estimate") {
    const scopeBlockers = scopeReadinessBlockers(request, company);
    if (scopeBlockers.length) throw new ClientWorkflowError(scopeBlockers.join(" "));
    if (!request.review.confirmed)
      throw new ClientWorkflowError("Confirm the reviewed scope before calculating effort.");
    if (!request.review.workPackages.length)
      throw new ClientWorkflowError("Add at least one work package before estimating.");
    if (
      request.review.confirmedConfigVersion !== company.config.version ||
      request.review.confirmedCompanyVersion !== company.version
    )
      throw new ClientWorkflowError(
        "Company configuration or knowledge changed. Edit and confirm the scope again.",
      );
    const historyRows = await getDb()
      .select()
      .from(workflowRequests)
      .where(eq(workflowRequests.companyId, company.id));
    const history = historyRows.filter((item) => item.id !== request.id).map(parseRequest);
    request.estimate = makeEstimate(request.review, company, history);
    request.status = "estimated";
    await saveRequest(ownerId, request, expectedVersion, company.id, actorId, input.action);
  } else if (input.action === "freeze") {
    const scopeBlockers = scopeReadinessBlockers(request, company);
    if (scopeBlockers.length) throw new ClientWorkflowError(scopeBlockers.join(" "));
    if (!request.review.confirmed || !request.estimate)
      throw new ClientWorkflowError(
        "Confirm the scope and calculate effort before freezing a baseline.",
      );
    if (
      request.estimate.configVersion !== company.config.version ||
      request.review.confirmedCompanyVersion !== company.version
    )
      throw new ClientWorkflowError(
        "Company configuration or knowledge changed. Review the scope and recalculate before freezing.",
      );
    const evaluation = await declareDeliverySplit(
      company.id,
      request.id,
      request.cohort ?? "synthetic",
      request.review.domain!,
      at,
    );
    const configuration = structuredClone(company.config);
    const knowledge = structuredClone(
      company.knowledge.filter((source) => source.status === "approved"),
    );
    const snapshot = {
      sourceText: request.text,
      sourceFiles: request.attachments.map((file) => ({
        name: file.name,
        sha256: file.sha256,
        status: file.status,
        text: file.text,
      })),
      review: structuredClone(request.review),
      estimate: structuredClone(request.estimate),
      configuration,
      knowledge,
      evaluation,
    };
    const baseline = {
      id: crypto.randomUUID(),
      revision: request.baselines.length + 1,
      createdAt: at,
      sha256: await digest(snapshot),
      configVersion: company.config.version,
      review: snapshot.review,
      estimate: snapshot.estimate,
      configuration,
      knowledge,
      evaluation,
    };
    request.baselines = [...request.baselines, baseline];
    request.status = "frozen";
    await saveRequest(ownerId, request, expectedVersion, company.id, actorId, input.action);
  }
  return getWorkspace(actorId, company.id);
}

export const responseError = (error: unknown) => {
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      },
      { status: 400 },
    );
  if (error instanceof ClientWorkflowError)
    return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "The workspace request failed.";
  if (/no such table|binding.*unavailable/i.test(message))
    return Response.json(
      { error: "Company storage is not ready. Apply the database migration." },
      { status: 503 },
    );
  return Response.json({ error: "The workspace request could not be completed." }, { status: 500 });
};

export async function requestFile(
  ownerId: string,
  companyId: string,
  requestId: string,
  fileId: string,
) {
  const { request, row } = await ownedRequest(ownerId, companyId, requestId);
  const file = request.attachments.find((item) => item.id === fileId && item.objectKey);
  if (!file?.objectKey) throw new ClientWorkflowError("Source file not found.", 404);
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!bucket) throw new ClientWorkflowError("Source file storage is not ready.", 503);
  const object = await bucket.get(file.objectKey);
  if (
    !object ||
    object.customMetadata?.ownerId !== row.ownerId ||
    object.customMetadata?.companyId !== companyId ||
    object.customMetadata?.requestId !== requestId ||
    object.customMetadata?.fileId !== fileId ||
    object.customMetadata?.sha256 !== file.sha256
  )
    throw new ClientWorkflowError("Source file not found.", 404);
  const filename = file.name.replace(/["\\\r\n]/g, "_");
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
