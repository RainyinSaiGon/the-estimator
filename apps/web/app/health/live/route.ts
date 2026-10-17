import { logHttpResponse, resolveRequestId } from "../../../lib/operations.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requestId = resolveRequestId(request);
  const startedAt = performance.now();
  const response = Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  return logHttpResponse(request, response, requestId, startedAt);
}
