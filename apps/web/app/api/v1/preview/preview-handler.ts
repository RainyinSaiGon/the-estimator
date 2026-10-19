import { configuredPreviewTimeoutMs, configuredServiceUrl } from "../../../../lib/operations.ts";
import { briefServiceAuthorization } from "../../../../lib/brief-service-auth.ts";

const maxBriefLength = 20_000;
const maxJsonBytes = 100_000;
const maxUploadBytes = 10 * 1024 * 1024;
const maxMultipartBytes = maxUploadBytes + 128_000;

type PreviewDependencies = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  briefUrl?: string;
  estimatorUrl?: string;
  requestId?: string;
};

type PreviewInput = {
  parser: "sample" | "ai";
  brief?: string;
  file?: File;
  capabilities: string[];
};

function errorResponse(error: unknown, status: number) {
  const detail = typeof error === "string" ? error : "The analysis service rejected this request.";
  return Response.json({ error: detail }, { status });
}

function validateCapabilities(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 30 || value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 160)) return null;
  return value.map((item: string) => item.trim());
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > limit) return Response.json({ error: "Request body is too large." }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function parseInput(request: Request): Promise<PreviewInput | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const multipart = contentType.startsWith("multipart/form-data;");
  const body = await readBoundedBody(request, multipart ? maxMultipartBytes : maxJsonBytes);
  if (body instanceof Response) return body;

  if (multipart) {
    try {
      const forwardedBytes = new ArrayBuffer(body.byteLength);
      new Uint8Array(forwardedBytes).set(body);
      const forwarded = new Request(request.url, { method: "POST", headers: request.headers, body: forwardedBytes });
      const form = await forwarded.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Choose a supported client file." }, { status: 400 });
      if (file.size > maxUploadBytes) return Response.json({ error: "Files must be 10 MB or smaller." }, { status: 413 });
      const parserValue = form.get("parser") ?? "sample";
      if (parserValue !== "sample" && parserValue !== "ai") return Response.json({ error: "Choose sample or AI analysis." }, { status: 400 });
      const capabilitiesRaw = form.get("capabilities") ?? "[]";
      if (typeof capabilitiesRaw !== "string") return Response.json({ error: "Team capabilities must be JSON text." }, { status: 400 });
      let capabilitiesValue: unknown;
      try { capabilitiesValue = JSON.parse(capabilitiesRaw); }
      catch { return Response.json({ error: "Team capabilities must be valid JSON text." }, { status: 400 }); }
      const capabilities = validateCapabilities(capabilitiesValue);
      if (!capabilities) return Response.json({ error: "Provide up to 30 non-empty team capabilities of 160 characters or fewer." }, { status: 400 });
      return { parser: parserValue, file, capabilities };
    } catch {
      return Response.json({ error: "Request must contain a valid multipart file upload." }, { status: 400 });
    }
  }

  if (!contentType.startsWith("application/json")) return Response.json({ error: "Use JSON text or a multipart file upload." }, { status: 415 });
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(body)); }
  catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: "Request body must be an object." }, { status: 400 });
  const record = value as Record<string, unknown>;
  const brief = record.brief;
  if (typeof brief !== "string" || brief.trim().length < 30 || brief.length > maxBriefLength) return Response.json({ error: "Use a brief between 30 and 20,000 characters." }, { status: 400 });
  const parserValue = record.parser ?? "sample";
  if (parserValue !== "sample" && parserValue !== "ai") return Response.json({ error: "Choose sample or AI analysis." }, { status: 400 });
  const capabilities = validateCapabilities(record.capabilities ?? []);
  if (!capabilities) return Response.json({ error: "Provide up to 30 non-empty team capabilities of 160 characters or fewer." }, { status: 400 });
  return { parser: parserValue, brief, capabilities };
}

export async function handlePreviewRequest(request: Request, dependencies: PreviewDependencies = {}) {
  const input = await parseInput(request);
  if (input instanceof Response) return input;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  try {
    const serviceAuthorization = await briefServiceAuthorization(input.file ? "briefs:analyze-document" : "briefs:analyze");
    if (!serviceAuthorization) {
      return Response.json({ error: "The analysis service is not configured." }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    const timeoutMs = dependencies.timeoutMs ?? configuredPreviewTimeoutMs();
    const briefUrl = dependencies.briefUrl ?? configuredServiceUrl("BRIEF_SERVICE_URL", "http://127.0.0.1:8001").toString().replace(/\/+$/, "");
    const deadline = Date.now() + timeoutMs;
    const signalForRemainingTime = () => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new DOMException("Preview timed out.", "TimeoutError");
      return AbortSignal.timeout(remainingMs);
    };
    const headers: Record<string, string> = { authorization: serviceAuthorization };
    if (dependencies.requestId) headers["x-request-id"] = dependencies.requestId;

    let analyzeUrl = `${briefUrl}/v1/briefs/analyze`;
    let analyzeBody: BodyInit;
    if (input.file) {
      analyzeUrl += "-document";
      const form = new FormData();
      form.append("file", input.file, input.file.name);
      form.append("parser", input.parser);
      form.append("capabilities", JSON.stringify(input.capabilities));
      analyzeBody = form;
    } else {
      headers["content-type"] = "application/json";
      analyzeBody = JSON.stringify({ brief: input.brief, parser: input.parser, capabilities: input.capabilities });
    }

    const scopeResponse = await fetchImpl(analyzeUrl, { method: "POST", headers, body: analyzeBody, signal: signalForRemainingTime(), cache: "no-store" });
    const scopeBody = await scopeResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!scopeResponse.ok) {
      if (scopeResponse.status === 504) return Response.json({ error: "AI analysis took too long. Please try again." }, { status: 503 });
      return errorResponse(scopeBody.detail, scopeResponse.status);
    }

    if (!Array.isArray(scopeBody.requirements) || scopeBody.requirements.length === 0) {
      return Response.json({ error: "No reviewable work items were found in the request." }, { status: 422 });
    }
    return Response.json({ scope: scopeBody }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && cause.name === "TimeoutError" ? "AI analysis took too long. Please try again." : "AI analysis is unavailable. Check the local services and try again.";
    return Response.json({ error: message }, { status: 503 });
  }
}

type ReviewScope = {
  summary: string;
  requirements: { id: string; title: string; evidence: string; complexity?: string }[];
  initialAnswers: Record<string, unknown>;
  risks: unknown[];
  parser: string;
  estimateMode: string;
  source: { reviewText: string };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeEvidence(value: string) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-")
    .replace(/\s+/g, " ").trim();
}

type ReviewScopeValidation = { ok: true; scope: ReviewScope } | { ok: false; error: string };

function validateReviewedScope(value: unknown): ReviewScopeValidation {
  const scope = asRecord(value);
  if (!scope || (scope.estimateMode !== "integration" && scope.estimateMode !== "general")) {
    return { ok: false, error: "The reviewed scope does not select a supported estimate path." };
  }
  const source = asRecord(scope.source);
  if (!source || typeof source.reviewText !== "string" || source.reviewText.length > maxBriefLength) {
    return { ok: false, error: "The extracted source is missing or exceeds the review limit. Analyze the request again." };
  }
  if (typeof scope.summary !== "string" || scope.summary.length > 500 || !Array.isArray(scope.requirements) || scope.requirements.length < 1 || scope.requirements.length > 30) {
    return { ok: false, error: "Keep at least one and no more than 30 reviewed work items." };
  }
  if (!Array.isArray(scope.risks) || scope.risks.some((risk) => typeof risk !== "string" || risk.length > 400)) {
    return { ok: false, error: "The reviewed risks are invalid. Analyze the request again." };
  }
  if (scope.parser !== "ai" && scope.parser !== "sample") {
    return { ok: false, error: "The analysis mode is invalid. Analyze the request again." };
  }
  const answers = asRecord(scope.initialAnswers);
  const allowedAnswers: Record<string, string[]> = {
    direction: ["unknown", "one-way", "two-way"],
    api: ["unknown", "documented", "custom"],
    quality: ["unknown", "clean", "mixed"],
    volume: ["unknown", "small", "medium", "large"],
    mapping: ["unknown", "standard", "custom"],
  };
  if (!answers || Object.entries(allowedAnswers).some(([key, allowed]) => !allowed.includes(String(answers[key] ?? "")))) {
    return { ok: false, error: "The estimator answers are incomplete or invalid. Analyze the request again." };
  }
  const integrationCategories = new Set(["discovery", "authentication", "mapping", "import", "sync", "deduplication", "testing", "handover"]);
  const sourceText = normalizeEvidence(source.reviewText);
  const requirements = [];
  for (const rawItem of scope.requirements) {
    const item = asRecord(rawItem);
    if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(item.id) ||
      typeof item.title !== "string" || !item.title.trim() || item.title.length > 240 ||
      typeof item.evidence !== "string" || !item.evidence.trim() || item.evidence.length > 1200) {
      return { ok: false, error: "Each work item needs a valid ID, title, and source quote." };
    }
    if (!sourceText.includes(normalizeEvidence(item.evidence))) {
      return { ok: false, error: `The evidence for “${item.title.slice(0, 120)}” is not an exact quote from the extracted source. Correct it before estimating.` };
    }
    if (scope.estimateMode === "integration" && !integrationCategories.has(item.id)) {
      return { ok: false, error: `The integration work item “${item.title.slice(0, 120)}” has an unsupported estimator category.` };
    }
    if (scope.estimateMode === "general" && !["small", "moderate", "complex"].includes(String(item.complexity))) {
      return { ok: false, error: `Choose a complexity band for “${item.title.slice(0, 120)}” before estimating.` };
    }
    if (item.complexity !== undefined && !["small", "moderate", "complex"].includes(String(item.complexity))) {
      return { ok: false, error: `Choose a valid complexity band for “${item.title.slice(0, 120)}” before estimating.` };
    }
    requirements.push({
      id: item.id,
      title: item.title.trim(),
      evidence: item.evidence.trim(),
      ...(item.complexity === undefined ? {} : { complexity: String(item.complexity) }),
    });
  }
  return {
    ok: true,
    scope: {
      summary: scope.summary,
      requirements,
      initialAnswers: Object.fromEntries(Object.keys(allowedAnswers).map((key) => [key, answers[key]])),
      risks: scope.risks,
      parser: scope.parser,
      estimateMode: scope.estimateMode,
      source: { reviewText: source.reviewText },
    },
  };
}

export async function handleEstimateConfirmation(request: Request, dependencies: PreviewDependencies = {}) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return Response.json({ error: "Use a JSON scope confirmation request." }, { status: 415 });
  const bytes = await readBoundedBody(request, maxJsonBytes);
  if (bytes instanceof Response) return bytes;
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const record = asRecord(body);
  if (!record) return Response.json({ error: "Request body must be an object." }, { status: 400 });
  if (record.reviewConfirmed !== true) return Response.json({ error: "Review and confirm the scope before requesting an estimate." }, { status: 400 });
  const validated = validateReviewedScope(record.scope);
  if (!validated.ok) return Response.json({ error: validated.error }, { status: 422 });

  try {
    const timeoutMs = dependencies.timeoutMs ?? configuredPreviewTimeoutMs();
    const estimatorUrl = dependencies.estimatorUrl ?? configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002").toString().replace(/\/+$/, "");
    const deadline = Date.now() + timeoutMs;
    const remainingSignal = () => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new DOMException("Estimate timed out.", "TimeoutError");
      return AbortSignal.timeout(remainingMs);
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (dependencies.requestId) headers["x-request-id"] = dependencies.requestId;
    let url = `${estimatorUrl}/v1/estimates`;
    let payload: Record<string, unknown>;
    if (validated.scope.estimateMode === "integration") {
      const integrationScope = {
        summary: validated.scope.summary,
        requirements: validated.scope.requirements.map(({ id, title, evidence }) => ({ id, title, evidence })),
        initialAnswers: validated.scope.initialAnswers,
        risks: validated.scope.risks,
        parser: validated.scope.parser,
      };
      payload = { scope: integrationScope, answers: validated.scope.initialAnswers, excluded: [], historyPolicy: "demo" };
    } else {
      url += "/general";
      payload = {
        workPackages: validated.scope.requirements.map(({ id, title, complexity }) => ({ id, title, complexity })),
      };
    }
    const estimateResponse = await (dependencies.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: remainingSignal(),
      cache: "no-store",
    });
    const estimateBody = await estimateResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!estimateResponse.ok) return errorResponse(estimateBody.error, estimateResponse.status);
    return Response.json({ estimate: estimateBody }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && cause.name === "TimeoutError" ? "Estimate calculation took too long. Please try again." : "Estimate calculation is unavailable. Check the local services and try again.";
    return Response.json({ error: message }, { status: 503 });
  }
}
