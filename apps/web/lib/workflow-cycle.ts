export type MailboxJob = { companyId: string; accountId: string };
export type AnalysisJob = MailboxJob & { requestId: string };
export type KnowledgeRefreshJob = MailboxJob & { documentId: string };
export type WorkflowJobs = { jobs: MailboxJob[]; analysisJobs?: AnalysisJob[]; knowledgeJobs?: KnowledgeRefreshJob[] };
type CycleDependencies = {
  loadJobs: () => Promise<WorkflowJobs>;
  syncMailbox: (companyId: string, actor: string) => Promise<{ imported: number }>;
  analyzeRequest: (companyId: string, requestId: string, actor: string) => Promise<unknown>;
  refreshKnowledge?: (job: KnowledgeRefreshJob) => Promise<unknown>;
};

/** Import first, then reload persisted work so new email starts analysis this cycle. */
export async function runWorkflowCycle(dependencies: CycleDependencies) {
  const initial = await dependencies.loadJobs();
  const mailboxes = [...new Map(initial.jobs.map(job => [job.companyId, job])).values()].slice(0, 2);
  const syncs = await Promise.allSettled(mailboxes.map(job => dependencies.syncMailbox(job.companyId, job.accountId)));
  const refreshed = mailboxes.length ? await dependencies.loadJobs() : initial;
  const queued = [...new Map((refreshed.analysisJobs ?? []).map(job => [job.companyId + ":" + job.requestId, job])).values()];
  const analyses = await Promise.allSettled(queued.slice(0, 3).map(job => dependencies.analyzeRequest(job.companyId, job.requestId, job.accountId)));
  const knowledge = (refreshed.knowledgeJobs ?? []).slice(0, 3);
  const refreshes = dependencies.refreshKnowledge ? await Promise.allSettled(knowledge.map(dependencies.refreshKnowledge)) : [];
  const mailboxesSynced = syncs.filter(result => result.status === "fulfilled").length;
  const requestsAnalyzed = analyses.filter(result => result.status === "fulfilled").length;
  const sourcesRefreshed = refreshes.filter(result => result.status === "fulfilled").length;
  return {
    completed: mailboxesSynced + requestsAnalyzed + sourcesRefreshed,
    failed: syncs.length + analyses.length + refreshes.length - mailboxesSynced - requestsAnalyzed - sourcesRefreshed,
    mailboxesSynced,
    imported: syncs.reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value.imported : 0), 0),
    requestsAnalyzed,
    sourcesRefreshed,
    pendingAnalyses: Math.max(0, queued.length - analyses.length),
  };
}
