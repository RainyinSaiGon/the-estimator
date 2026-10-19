import HomeLanding from "./home-landing";
import { accountForSession, identityAuthConfigured } from "../lib/identity";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const identityEnabled = identityAuthConfigured();
  const session = identityEnabled ? await accountForSession() : null;
  return <HomeLanding identityEnabled={identityEnabled} displayName={session?.account.displayName ?? null} />;
}
