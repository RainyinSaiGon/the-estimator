import CompanyWorkspace from "./workspace";
import { getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company request workspace · The Estimator" };

export default async function CompanyWorkspacePage() {
  const user = await getChatGPTUser();
  return <CompanyWorkspace userName={user?.displayName ?? ""} guest={!user} />;
}
