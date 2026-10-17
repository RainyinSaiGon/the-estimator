import { randomUUID } from "node:crypto";

const requestIdPattern = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function resolveRequestId(request: Request): string {
  const candidate = request.headers.get("x-request-id");
  return candidate && requestIdPattern.test(candidate) ? candidate : randomUUID();
}

export function logHttpResponse(
  request: Request,
  response: Response,
  requestId: string,
  startedAt: number,
): Response {
  const path = new URL(request.url).pathname;
  const event = {
    timestamp: new Date().toISOString(),
    level: response.status >= 500 ? "error" : "info",
    service: "web",
    event: "http_request",
    request_id: requestId,
    method: request.method,
    path,
    status: response.status,
    duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
  };
  const line = JSON.stringify(event);
  if (response.status >= 500) console.error(line);
  else console.info(line);

  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function configuredServiceUrl(name: "BRIEF_SERVICE_URL" | "ESTIMATOR_SERVICE_URL", fallback: string): URL {
  const raw = process.env[name] ?? fallback;
  const url = new URL(raw);
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Service URL configuration is invalid.");
  }
  return url;
}

export function configuredPreviewTimeoutMs(): number {
  const raw = process.env.PREVIEW_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 50_000;
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("PREVIEW_TIMEOUT_MS must be between 100 and 60000.");
  }
  return timeoutMs;
}
