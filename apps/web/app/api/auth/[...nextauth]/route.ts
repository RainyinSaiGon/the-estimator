import type { NextRequest } from "next/server";
import { authHandler, oidcConfigured } from "../../../../auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  return Response.json({ error: "Organization sign-in has not been configured." }, { status: 503, headers: { "cache-control": "no-store" } });
}

export function GET(request: NextRequest) {
  return oidcConfigured ? authHandler(request) : unavailable();
}

export function POST(request: NextRequest) {
  return oidcConfigured ? authHandler(request) : unavailable();
}
