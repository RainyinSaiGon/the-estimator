import { getChatGPTUser } from "../../../chatgpt-auth";
import { ensureClientWorkflowSchema, getWorkspace, responseError } from "../../../../lib/client-workflow";
import { configuredIntakeSchema } from "../../../../lib/workflow-knowledge";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to read company configuration." }, { status: 401 });
  try {
    await ensureClientWorkflowSchema();
    const id = new URL(request.url).searchParams.get("company");
    if (!id) return Response.json({ error: "A company is required." }, { status: 400 });
    const company = (await getWorkspace(user.userId, id)).company;
    if (!company) return Response.json({ error: "Company workspace not found." }, { status: 404 });
    return Response.json(configuredIntakeSchema(company.config), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return responseError(error); }
}
