import test from "node:test";
import assert from "node:assert/strict";
import { runWorkflowCycle } from "../apps/web/lib/workflow-cycle.ts";

test("new client email is imported then analyzed in the same worker cycle", async () => {
  const events = [];
  const analysisJobs = [];
  const mailbox = { companyId: "company", accountId: "owner" };
  const result = await runWorkflowCycle({
    loadJobs: async () => { events.push("load"); return { jobs: [mailbox], analysisJobs: [...analysisJobs] }; },
    syncMailbox: async (company, actor) => {
      assert.equal(company, "company"); assert.equal(actor, "owner");
      events.push("import");
      analysisJobs.push({ ...mailbox, requestId: "new-email" });
      return { imported: 1 };
    },
    analyzeRequest: async (company, request, actor) => {
      assert.equal(company, "company"); assert.equal(request, "new-email"); assert.equal(actor, "owner");
      events.push("analyze");
    },
  });
  assert.deepEqual(events, ["load", "import", "load", "analyze"]);
  assert.equal(result.imported, 1);
  assert.equal(result.requestsAnalyzed, 1);
  assert.equal(result.failed, 0);
});

test("one disconnected mailbox does not prevent another mailbox's imported work", async () => {
  const healthy = { companyId: "healthy", accountId: "owner-2" };
  const broken = { companyId: "broken", accountId: "owner-1" };
  let imported = false;
  const analyzed = [];
  const result = await runWorkflowCycle({
    loadJobs: async () => ({ jobs: [broken, healthy], analysisJobs: imported ? [{ ...healthy, requestId: "request" }] : [] }),
    syncMailbox: async company => {
      if (company === "broken") throw new Error("Disconnected test mailbox");
      imported = true; return { imported: 1 };
    },
    analyzeRequest: async (...args) => analyzed.push(args),
  });
  assert.deepEqual(analyzed, [["healthy", "request", "owner-2"]]);
  assert.equal(result.failed, 1);
  assert.equal(result.requestsAnalyzed, 1);
});

test("repeated queue entries are deduplicated and batch capacity is bounded", async () => {
  const first = { companyId: "company", accountId: "owner", requestId: "request-0" };
  const jobs = [first, first, ...Array.from({ length: 4 }, (_, i) => ({ ...first, requestId: "request-" + (i + 1) }))];
  const analyzed = [];
  const result = await runWorkflowCycle({
    loadJobs: async () => ({ jobs: [], analysisJobs: jobs }),
    syncMailbox: async () => { throw new Error("No mailbox work expected"); },
    analyzeRequest: async (_company, request) => analyzed.push(request),
  });
  assert.deepEqual(analyzed, ["request-0", "request-1", "request-2"]);
  assert.equal(result.pendingAnalyses, 2);
});

test("completed email work is not analyzed again on the next poll", async () => {
  const mailbox = { companyId: "company", accountId: "owner" };
  let queued = false, seen = false, analyses = 0;
  const dependencies = {
    loadJobs: async () => ({ jobs: [mailbox], analysisJobs: queued ? [{ ...mailbox, requestId: "request" }] : [] }),
    syncMailbox: async () => {
      if (seen) return { imported: 0 };
      seen = true; queued = true; return { imported: 1 };
    },
    analyzeRequest: async () => { analyses++; queued = false; },
  };
  await runWorkflowCycle(dependencies);
  const second = await runWorkflowCycle(dependencies);
  assert.equal(analyses, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.requestsAnalyzed, 0);
});
