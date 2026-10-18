import { privateRecordStatus } from "../../../../../lib/private-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return privateRecordStatus();
}
