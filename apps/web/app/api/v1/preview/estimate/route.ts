import { handleEstimateConfirmation } from "../preview-handler";
import { logHttpResponse, resolveRequestId } from "../../../../../lib/operations.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await handleEstimateConfirmation(request, { requestId });
  } catch {
    response = Response.json({ error: "The confirmed estimate could not be created." }, { status: 500 });
  }
  return logHttpResponse(request, response, requestId, startedAt);
}
