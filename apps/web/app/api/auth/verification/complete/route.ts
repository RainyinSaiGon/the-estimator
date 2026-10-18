import { completeIdentityVerification } from "../../../../../lib/identity-bff";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return completeIdentityVerification(request);
}
