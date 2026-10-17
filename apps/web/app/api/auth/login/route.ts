import { createIdentitySession } from "../../../../lib/identity-bff";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return createIdentitySession(request, "/v1/sessions");
}
