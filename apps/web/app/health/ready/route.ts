import { configuredServiceUrl, logHttpResponse, resolveRequestId } from "../../../lib/operations.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  const startedAt = performance.now();
  let ready = false;
  try {
    const briefHealth = new URL("/health/ready", configuredServiceUrl("BRIEF_SERVICE_URL", "http://127.0.0.1:8001"));
    const estimatorHealth = new URL("/health/ready", configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002"));
    const responses = await Promise.all([
      fetch(briefHealth, { cache: "no-store", signal: AbortSignal.timeout(1_500) }),
      fetch(estimatorHealth, { cache: "no-store", signal: AbortSignal.timeout(1_500) }),
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json().catch(() => null) as Promise<Record<string, unknown> | null>));
    ready = responses[0].ok
      && responses[1].ok
      && payloads[0]?.status === "ready"
      && payloads[0]?.parser === "sample"
      && payloads[1]?.status === "ready"
      && payloads[1]?.engine === "integration-effort/2.0";
  } catch {
    ready = false;
  }
  const response = ready
    ? Response.json({ status: "ready", service: "web" }, { headers: { "cache-control": "no-store" } })
    : Response.json({ status: "not_ready", service: "web" }, { status: 503, headers: { "cache-control": "no-store" } });
  return logHttpResponse(request, response, requestId, startedAt);
}
