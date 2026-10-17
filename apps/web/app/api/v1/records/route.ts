import { proxyPrivateRecordRequest } from "../../../../lib/private-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyPrivateRecordRequest(request, "/v1/records");
}

export function POST(request: Request) {
  return proxyPrivateRecordRequest(request, "/v1/records");
}

export function DELETE(request: Request) {
  return proxyPrivateRecordRequest(request, "/v1/records");
}
