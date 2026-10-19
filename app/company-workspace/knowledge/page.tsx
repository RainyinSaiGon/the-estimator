import { getChatGPTUser, chatGPTSignInPath } from "../../chatgpt-auth";
import KnowledgeSourcesManager from "./manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approved knowledge sources · The Estimator" };

export default async function KnowledgeSourcesPage() {
  const user = await getChatGPTUser();
  if (!user) return <main className="mx-auto max-w-3xl px-5 py-16"><div className="rounded-3xl border border-estimator-line bg-white p-8 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-estimator-muted">The Estimator</p><h1 className="mt-3 text-3xl font-medium tracking-tight text-estimator-ink">Company knowledge sources</h1><p className="mt-4 text-sm leading-6 text-estimator-muted">Sign in with your Site account to manage approved documentation.</p><a className="mt-6 inline-flex min-h-11 items-center rounded-full bg-estimator-ink px-5 text-sm font-medium text-white" href={chatGPTSignInPath("/company-workspace/knowledge")}>Sign in</a></div></main>;
  return <KnowledgeSourcesManager userName={user.displayName} />;
}
