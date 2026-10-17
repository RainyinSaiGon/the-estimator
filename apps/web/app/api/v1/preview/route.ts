import { handlePreviewRequest } from "./preview-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handlePreviewRequest(request);
}
