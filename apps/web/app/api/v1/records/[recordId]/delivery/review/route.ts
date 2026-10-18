import { proxyPrivateRecordRequest } from "../../../../../../../lib/private-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await context.params;
  return proxyPrivateRecordRequest(request, `/v1/records/${encodeURIComponent(recordId)}/delivery/review`);
}

export async function PATCH(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await context.params;
  return proxyPrivateRecordRequest(request, `/v1/records/${encodeURIComponent(recordId)}/delivery/review`);
}
