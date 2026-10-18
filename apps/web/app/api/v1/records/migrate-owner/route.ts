import { proxyLegacyOwnerMigration } from "../../../../../lib/private-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return proxyLegacyOwnerMigration(request);
}
