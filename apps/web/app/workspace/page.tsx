import { redirect } from "next/navigation";
import { accountForSession } from "../../lib/identity";
import CompanyWorkspace from "./workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company workspace · The Estimator" };
export default async function WorkspacePage() {
  const session = await accountForSession();
  if (!session) redirect("/sign-in?returnTo=%2Fworkspace");
  return <CompanyWorkspace account={session.account} />;
}
