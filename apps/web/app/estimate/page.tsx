import EstimateWorkbench from "./workbench";
import { accountForSession, identityAuthConfigured } from "../../lib/identity";

export const dynamic = "force-dynamic";

export const metadata = { title: "Scope a brief · The Estimator" };

export default async function EstimatePage({ searchParams }: { searchParams: Promise<{ reviewDelivery?: string | string[]; sample?: string | string[] }> }) {
  const identityEnabled = identityAuthConfigured();
  const session = identityEnabled ? await accountForSession() : null;
  const params = await searchParams;
  const reviewDeliveryId = typeof params.reviewDelivery === "string" ? params.reviewDelivery : "";
  const initialSample = params.sample === "1";
  return <EstimateWorkbench identityEnabled={identityEnabled} account={session?.account ?? null} initialReviewRecordId={reviewDeliveryId} initialSample={initialSample} />;
}
