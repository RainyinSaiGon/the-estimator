import { configuredPreviewTimeoutMs, configuredServiceUrl } from "../../../../lib/operations.ts";

const maxBriefLength = 20_000;
const maxRequestBytes = 100_000;

type PreviewDependencies = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  briefUrl?: string;
  estimatorUrl?: string;
  requestId?: string;
};

export async function handlePreviewRequest(request: Request, dependencies: PreviewDependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  let body: unknown;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRequestBytes) return Response.json({ error: "Request body is too large." }, { status: 413 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBytes) {
        await reader.cancel();
        return Response.json({ error: "Request body is too large." }, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  }
  catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "Request body must be an object." }, { status: 400 });
  const { brief, parser = "sample" } = body as { brief?: unknown; parser?: unknown };
  if (typeof brief !== "string" || brief.trim().length < 30 || brief.length > maxBriefLength) return Response.json({ error: "Use a brief between 30 and 20,000 characters." }, { status: 400 });
  if (parser !== "sample" && parser !== "ai") return Response.json({ error: "Choose the sample parser." }, { status: 400 });
  if (parser === "ai") return Response.json({ error: "AI parsing is not configured. Choose the sample parser." }, { status: 503 });

  try {
    const timeoutMs = dependencies.timeoutMs ?? configuredPreviewTimeoutMs();
    const briefUrl = dependencies.briefUrl ?? configuredServiceUrl("BRIEF_SERVICE_URL", "http://127.0.0.1:8001").toString().replace(/\/+$/, "");
    const estimatorUrl = dependencies.estimatorUrl ?? configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002").toString().replace(/\/+$/, "");
    const deadline = Date.now() + timeoutMs;
    const signalForRemainingTime = () => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new DOMException("Preview timed out.", "TimeoutError");
      return AbortSignal.timeout(remainingMs);
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (dependencies.requestId) headers["x-request-id"] = dependencies.requestId;
    const scopeResponse = await fetchImpl(`${briefUrl}/v1/briefs/analyze`, { method: "POST", headers, body: JSON.stringify({ brief, parser: "sample" }), signal: signalForRemainingTime(), cache: "no-store" });
    const scopeBody = await scopeResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!scopeResponse.ok) {
      if (scopeResponse.status === 504) return Response.json({ error: "A service took too long to respond. Try again." }, { status: 503 });
      return Response.json({ error: scopeBody.detail ?? "Brief service could not analyze this request." }, { status: scopeResponse.status });
    }

    const estimateResponse = await fetchImpl(`${estimatorUrl}/v1/estimates`, { method: "POST", headers, body: JSON.stringify({ scope: scopeBody, answers: scopeBody.initialAnswers, excluded: [], historyPolicy: "demo" }), signal: signalForRemainingTime(), cache: "no-store" });
    const estimateBody = await estimateResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!estimateResponse.ok) return Response.json({ error: estimateBody.error ?? "Estimator service could not create the preview." }, { status: estimateResponse.status });
    return Response.json({ scope: scopeBody, estimate: estimateBody }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && cause.name === "TimeoutError" ? "A service took too long to respond. Try again." : "A preview service is unavailable. Start the local services and try again.";
    return Response.json({ error: message }, { status: 503 });
  }
}
