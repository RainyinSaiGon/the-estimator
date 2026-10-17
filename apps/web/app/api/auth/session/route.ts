import { readIdentitySession } from "../../../../lib/identity-bff";

export const runtime = "nodejs";

export async function GET() {
  return readIdentitySession();
}
