import { proxyPrivateRecordRequest } from "../../../../../lib/private-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ recordId: string }> };

async function servicePath(context: RouteContext) {
  const { recordId } = await context.params;
  return `/v1/records/${encodeURIComponent(recordId)}`;
}

export async function GET(request: Request, context: RouteContext) {
  return proxyPrivateRecordRequest(request, await servicePath(context));
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxyPrivateRecordRequest(request, await servicePath(context));
}
