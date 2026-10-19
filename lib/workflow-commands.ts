import { env } from "cloudflare:workers";
import type { z } from "zod";
import type { ClientRequest, Company, CompanyRole, WorkspaceResponse } from "./client-workflow-types";
import { PUBLIC_DEMO_ACTOR_ID } from "./public-demo-access";
import { requestMaterial, reviewFromAnalysis, runAI } from "./workflow-analysis";
import { defaultConfig } from "./workflow-defaults";
import { ClientWorkflowError } from "./workflow-errors";
import { declareDeliverySplit } from "./workflow-evaluation";
import { protectCredential, requireCompanyRole, textDigest } from "./workflow-governance";
import { makeEstimate, scopeReadinessBlockers } from "./workflow-planning";
import type { actionSchema } from "./workflow-validation";
import {
  createCompanyRecord,
  createRequestRecord,
  deleteRequestRecord,
  ownedCompany,
  ownedRequest,
  readRequestHistory,
  revokeCredentialRecord,
  saveCompanyRecord,
  saveCredentialRecord,
  saveMemberRecord,
  saveRequest,
} from "./workflow-command-repository";

type WorkflowCommand = z.infer<typeof actionSchema>;
type CommandName = WorkflowCommand["action"];
type CommandInput<Name extends CommandName> = Extract<WorkflowCommand, { action: Name }>;
type CompanyCommand = Exclude<WorkflowCommand, CommandInput<"createCompany">>;
type CommandContext = {
  actorId: string;
  userName: string;
  at: string;
  inbound?: { submissionId: string; payloadDigest: string };
};
type CompanyCommandContext = CommandContext & { company: Company };
type CommandResult = {
  companyId: string;
  requestId?: string;
  issuedCredential?: WorkspaceResponse["issuedCredential"];
};
type RolePolicy = { scope: "account" } | { scope: "company"; roles: CompanyRole[] };

/** Adding an API action requires an explicit authorization policy and handler. */
export const commandRolePolicy = {
  createCompany: { scope: "account" },
  saveConfiguration: { scope: "company", roles: ["admin"] },
  addKnowledge: { scope: "company", roles: ["admin"] },
  approveKnowledge: { scope: "company", roles: ["admin"] },
  retireKnowledge: { scope: "company", roles: ["admin"] },
  setMember: { scope: "company", roles: ["admin"] },
  removeMember: { scope: "company", roles: ["admin"] },
  rotateCredential: { scope: "company", roles: ["admin"] },
  revokeCredential: { scope: "company", roles: ["admin"] },
  createRequest: { scope: "company", roles: ["admin", "estimator"] },
  analyze: { scope: "company", roles: ["admin", "estimator"] },
  saveReview: { scope: "company", roles: ["admin", "estimator"] },
  confirmScope: { scope: "company", roles: ["admin", "estimator"] },
  estimate: { scope: "company", roles: ["admin", "estimator"] },
  freeze: { scope: "company", roles: ["admin", "estimator"] },
  saveTracking: { scope: "company", roles: ["admin", "estimator"] },
  deleteRequest: { scope: "company", roles: ["admin", "estimator"] },
  submitDelivery: { scope: "company", roles: ["admin", "estimator"] },
  reviewDelivery: { scope: "company", roles: ["admin", "reviewer"] },
} satisfies Record<CommandName, RolePolicy>;

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function handleCreateCompany(input: CommandInput<"createCompany">, context: CommandContext): Promise<CommandResult> {
  return { companyId: await createCompanyRecord(context.actorId, input.name, defaultConfig(), context.at) };
}

async function handleMember(input: CommandInput<"setMember"> | CommandInput<"removeMember">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, company } = context;
  const ownerId = company.ownerId;

  if (input.userId === ownerId)
    throw new ClientWorkflowError("The workspace owner's administrator role cannot be changed.");
  if (
    input.action === "setMember" &&
    company.members.length >= 100 &&
    !company.members.some((member) => member.userId === input.userId)
  )
    throw new ClientWorkflowError("This workspace supports at most 100 members.");
  await saveMemberRecord(company.id, input, actorId, at);
  return { companyId: company.id };
}

async function handleCredential(input: CommandInput<"rotateCredential"> | CommandInput<"revokeCredential">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, company } = context;

  if (input.action === "revokeCredential") {
    await revokeCredentialRecord(company.id, input.kind, actorId);
    return { companyId: company.id };
  }
  const token = `est_${input.kind}_${[...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const verifier =
    input.kind === "webhook"
      ? await protectCredential(token, company.id)
      : await textDigest(token);
  await saveCredentialRecord(company.id, input.kind, verifier, actorId, at);
  return {
    companyId: company.id,
    issuedCredential: { kind: input.kind, value: token },
  };
}

async function handleSaveConfiguration(input: CommandInput<"saveConfiguration">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, company } = context;

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
  await saveCompanyRecord(
    company, updatedConfig, company.knowledge, actorId,
    `configuration.saved:v${updatedConfig.version}`, at,
    "Company settings changed while saving. Refresh and retry.",
  );
  return { companyId: company.id };
}

async function handleKnowledge(input: CommandInput<"addKnowledge"> | CommandInput<"approveKnowledge"> | CommandInput<"retireKnowledge">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, userName, at, company } = context;

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
  await saveCompanyRecord(
    company, company.config, knowledge, actorId, input.action, at,
    "Company knowledge changed while saving. Refresh and retry.",
  );
  return { companyId: company.id };
}

async function handleCreateRequest(input: CommandInput<"createRequest">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, inbound, company } = context;
  const ownerId = company.ownerId;

  const intakeActor = inbound ? `webhook:${company.id}` : actorId;
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
  await createRequestRecord(request, ownerId, company.id, intakeActor, at, inbound);
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
  return { companyId: company.id, requestId: request.id };
}

async function handleDelivery(input: CommandInput<"submitDelivery"> | CommandInput<"reviewDelivery">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, userName, at, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;

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
  return { companyId: company.id };
}

async function handleSaveTracking(input: CommandInput<"saveTracking">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, userName, at, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;

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
  return { companyId: company.id };
}

async function handleDeleteRequest(input: CommandInput<"deleteRequest">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;

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
  await deleteRequestRecord(request.id, ownerId, company.id, expectedVersion);
  if (bucket) {
    const keys = request.attachments
      .map((file) => file.objectKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length) await bucket.delete(keys);
  }
  return { companyId: company.id };
}

async function handleAnalyze(input: CommandInput<"analyze">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;
  if (request.status === "frozen")
    throw new ClientWorkflowError(
      "This request has a frozen baseline. Start a new version to change scope.",
    );
  request.version += 1;
  request.updatedAt = at;

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
  return { companyId: company.id };
}

async function handleSaveReview(input: CommandInput<"saveReview">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;
  if (request.status === "frozen")
    throw new ClientWorkflowError(
      "This request has a frozen baseline. Start a new version to change scope.",
    );
  request.version += 1;
  request.updatedAt = at;

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
  return { companyId: company.id };
}

async function handleConfirmScope(input: CommandInput<"confirmScope">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, userName, at, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;
  if (request.status === "frozen")
    throw new ClientWorkflowError(
      "This request has a frozen baseline. Start a new version to change scope.",
    );
  request.version += 1;
  request.updatedAt = at;

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
  return { companyId: company.id };
}

async function handleEstimate(input: CommandInput<"estimate">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;
  if (request.status === "frozen")
    throw new ClientWorkflowError(
      "This request has a frozen baseline. Start a new version to change scope.",
    );
  request.version += 1;
  request.updatedAt = at;

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
  const history = await readRequestHistory(company.id, request.id);
  request.estimate = makeEstimate(request.review, company, history);
  request.status = "estimated";
  await saveRequest(ownerId, request, expectedVersion, company.id, actorId, input.action);
  return { companyId: company.id };
}

async function handleFreeze(input: CommandInput<"freeze">, context: CompanyCommandContext): Promise<CommandResult> {
  const { actorId, at, company } = context;
  const ownerId = company.ownerId;
  const { request, row } = await ownedRequest(actorId, company.id, input.requestId, input.expectedVersion);
  const expectedVersion = row.version;
  if (request.status === "frozen")
    throw new ClientWorkflowError(
      "This request has a frozen baseline. Start a new version to change scope.",
    );
  request.version += 1;
  request.updatedAt = at;

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
  return { companyId: company.id };
}

type CompanyHandlers = {
  [Name in CompanyCommand["action"]]: (input: CommandInput<Name>, context: CompanyCommandContext) => Promise<CommandResult>;
};

const companyHandlers = {
  saveConfiguration: handleSaveConfiguration,
  addKnowledge: handleKnowledge,
  approveKnowledge: handleKnowledge,
  retireKnowledge: handleKnowledge,
  setMember: handleMember,
  removeMember: handleMember,
  rotateCredential: handleCredential,
  revokeCredential: handleCredential,
  createRequest: handleCreateRequest,
  analyze: handleAnalyze,
  saveReview: handleSaveReview,
  confirmScope: handleConfirmScope,
  estimate: handleEstimate,
  freeze: handleFreeze,
  saveTracking: handleSaveTracking,
  deleteRequest: handleDeleteRequest,
  submitDelivery: handleDelivery,
  reviewDelivery: handleDelivery,
} satisfies CompanyHandlers;

function unreachableCommand(command: never): never {
  throw new Error(`Unhandled workflow command: ${JSON.stringify(command)}`);
}

export async function executeWorkflowCommand(input: WorkflowCommand, context: CommandContext): Promise<CommandResult> {
  if (input.action === "createCompany") return handleCreateCompany(input, context);
  const company = await ownedCompany(context.actorId, input.companyId);
  requireCompanyRole(company.role, commandRolePolicy[input.action].roles);
  const companyContext = { ...context, company };
  // Narrowing each action keeps dispatch exhaustive without casting a union handler.
  switch (input.action) {
    case "saveConfiguration": return companyHandlers.saveConfiguration(input, companyContext);
    case "addKnowledge": return companyHandlers.addKnowledge(input, companyContext);
    case "approveKnowledge": return companyHandlers.approveKnowledge(input, companyContext);
    case "retireKnowledge": return companyHandlers.retireKnowledge(input, companyContext);
    case "setMember": return companyHandlers.setMember(input, companyContext);
    case "removeMember": return companyHandlers.removeMember(input, companyContext);
    case "rotateCredential": return companyHandlers.rotateCredential(input, companyContext);
    case "revokeCredential": return companyHandlers.revokeCredential(input, companyContext);
    case "createRequest": return companyHandlers.createRequest(input, companyContext);
    case "analyze": return companyHandlers.analyze(input, companyContext);
    case "saveReview": return companyHandlers.saveReview(input, companyContext);
    case "confirmScope": return companyHandlers.confirmScope(input, companyContext);
    case "estimate": return companyHandlers.estimate(input, companyContext);
    case "freeze": return companyHandlers.freeze(input, companyContext);
    case "saveTracking": return companyHandlers.saveTracking(input, companyContext);
    case "deleteRequest": return companyHandlers.deleteRequest(input, companyContext);
    case "submitDelivery": return companyHandlers.submitDelivery(input, companyContext);
    case "reviewDelivery": return companyHandlers.reviewDelivery(input, companyContext);
    default: return unreachableCommand(input);
  }
}
