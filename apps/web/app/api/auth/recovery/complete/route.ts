import { completeIdentityPasswordRecovery } from "../../../../../lib/identity-bff";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return completeIdentityPasswordRecovery(request);
}
