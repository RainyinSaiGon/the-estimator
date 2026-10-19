import WorkspaceApp from "./workspace-app";
import { getChatGPTUser } from "./chatgpt-auth";
import { redirect } from "next/navigation";
import { publicDemoAccessEnabled } from "../lib/company-workspace-access";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user && publicDemoAccessEnabled()) redirect("/company-workspace");
  return <WorkspaceApp guest={!user} />;
}
