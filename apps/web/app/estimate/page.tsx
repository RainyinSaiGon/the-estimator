import EstimateWorkbench from "./workbench";
import { accountForSession, identityAuthConfigured } from "../../lib/identity";

export const dynamic = "force-dynamic";

export const metadata = { title: "Scope a brief · The Estimator" };

export default async function EstimatePage() {
  const identityEnabled = identityAuthConfigured();
  const session = identityEnabled ? await accountForSession() : null;
  return <EstimateWorkbench identityEnabled={identityEnabled} account={session?.account ?? null} />;
}
