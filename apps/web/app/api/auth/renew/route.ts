import { renewIdentitySession } from "../../../../lib/identity-bff";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return renewIdentitySession(request);
}
