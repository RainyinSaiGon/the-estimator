import CompanyWorkspace from "./workspace";
import { companyWorkspaceAccess } from "../../lib/company-workspace-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company request workspace · The Estimator" };

export default async function CompanyWorkspacePage() {
  const access = await companyWorkspaceAccess();
  return <CompanyWorkspace userName={access?.user.displayName ?? ""} guest={!access} publicDemo={access?.publicDemo ?? false} />;
}
