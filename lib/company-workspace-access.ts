import { getChatGPTUser, type ChatGPTUser } from "../app/chatgpt-auth";
import { PUBLIC_DEMO_ACTOR_ID, publicDemoAccessEnabled } from "./public-demo-access";

export { PUBLIC_DEMO_ACTOR_ID, publicDemoAccessEnabled } from "./public-demo-access";

const publicDemoAccount: ChatGPTUser = {
  userId: PUBLIC_DEMO_ACTOR_ID,
  displayName: "Public demo",
  email: "public-demo@the-estimator.invalid",
  fullName: "Public demo",
};

export type CompanyWorkspaceAccess = {
  user: ChatGPTUser;
  publicDemo: boolean;
};

export async function companyWorkspaceAccess(): Promise<CompanyWorkspaceAccess | null> {
  const user = await getChatGPTUser();
  if (user) return { user, publicDemo: false };
  if (publicDemoAccessEnabled()) return { user: publicDemoAccount, publicDemo: true };
  return null;
}
