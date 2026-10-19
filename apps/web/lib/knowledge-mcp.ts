import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createKnowledgeServer } from "./knowledge-mcp-server";
import { companyContext } from "./gmail-workflow";
import { equalSecret, workflowActor, workflowData, WorkflowError } from "./workflow-service";
import type { Company, Passage } from "./workflow-types";

export async function handleKnowledgeMCP(request: Request, companyId: string) {
  const origin = request.headers.get("origin");
  const expected = process.env.WORKFLOW_PUBLIC_URL || new URL(request.url).origin;
  if (origin && new URL(origin).origin !== new URL(expected).origin) throw new WorkflowError("This MCP origin is not allowed.", 403);
  let actor: string;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (bearer) {
    const context = await companyContext(companyId);
    const digest = createHash("sha256").update(bearer).digest("hex");
    if (!context.knowledgeTokenHash || !equalSecret(digest, context.knowledgeTokenHash)) throw new WorkflowError("Invalid company knowledge token.", 401);
    actor = context.knowledgeTokenActor;
  } else actor = await workflowActor();
  const company = await workflowData<Company>("companies/" + companyId, "GET", undefined, actor);
  const server = createKnowledgeServer(companyId, company.knowledge, query => workflowData<{ passages: Passage[] }>(`companies/${companyId}/knowledge?q=${encodeURIComponent(query)}`, "GET", undefined, actor));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close(); }
}
