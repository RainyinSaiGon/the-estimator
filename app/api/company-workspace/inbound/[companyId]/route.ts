import { receiveInbound } from "../../../../../lib/workflow-inbound";
import { responseError } from "../../../../../lib/client-workflow";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ companyId: string }> }) {
  try {
    const result = await receiveInbound(request, (await context.params).companyId);
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
