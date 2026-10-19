import { env } from "cloudflare:workers";
import { getChatGPTUser, type ChatGPTUser } from "../app/chatgpt-auth";

const publicDemoAccount: ChatGPTUser = {
  userId: "public-demo:shared",
  displayName: "Public demo",
  email: "public-demo@the-estimator.invalid",
  fullName: "Public demo",
};

export type CompanyWorkspaceAccess = {
  user: ChatGPTUser;
  publicDemo: boolean;
};

export function publicDemoAccessEnabled() {
  const vars = env as unknown as Record<string, string | undefined>;
  return vars.PUBLIC_DEMO_ACCESS === "true";
}

export async function companyWorkspaceAccess(): Promise<CompanyWorkspaceAccess | null> {
  const user = await getChatGPTUser();
  if (user) return { user, publicDemo: false };
  if (publicDemoAccessEnabled()) return { user: publicDemoAccount, publicDemo: true };
  return null;
}
