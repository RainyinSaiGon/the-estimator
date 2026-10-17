import assert from "node:assert/strict";
import { handleEstimateConfirmation, handlePreviewRequest } from "../apps/web/app/api/v1/preview/preview-handler.ts";

const briefUrl = "http://brief.test";
const estimatorUrl = "http://estimator.test";
const sampleBrief = "Import customer records and connect the CRM systems for a nightly synchronization.";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { scope, estimate } = JSON.parse(input);

function makeRequest(body, path = "/api/v1/preview") {
  return new Request(`http://estimator.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function makeOptions(fetchImpl, timeoutMs = 1000) {
  return { fetchImpl, timeoutMs, briefUrl, estimatorUrl, requestId: "00000000-0000-4000-8000-000000000001" };
}

const results = [];

async function collect(name, response, expectedStatus) {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${name} returned an unexpected HTTP status`);
  results.push({ name, status: response.status, body });
}

const analysisCalls = [];
const analysisResponse = await handlePreviewRequest(
  makeRequest(JSON.stringify({ brief: sampleBrief, parser: "sample" })),
  makeOptions(async (url, options) => {
    analysisCalls.push({ url, options });
    assert.equal(url, `${briefUrl}/v1/briefs/analyze`);
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers["content-type"], "application/json");
    assert.equal(options.headers["x-request-id"], "00000000-0000-4000-8000-000000000001");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(JSON.parse(options.body).parser, "sample");
    return Response.json(scope);
  }),
);
assert.equal(analysisCalls.length, 1, "analysis must call only Python and must not calculate an estimate");
assert.equal(analysisResponse.headers.get("cache-control"), "no-store");
await collect("analysis-success", analysisResponse, 200);

const documentScope = { ...scope, source: { ...scope.source, name: "client-brief.txt", type: "txt" } };
const documentForm = new FormData();
documentForm.append("file", new File([sampleBrief], "client-brief.txt", { type: "text/plain" }));
documentForm.append("parser", "sample");
documentForm.append("capabilities", "[]");
const documentAnalysisResponse = await handlePreviewRequest(
  new Request("http://estimator.test/api/v1/preview", { method: "POST", body: documentForm }),
  makeOptions(async (url, options) => {
    assert.equal(url, `${briefUrl}/v1/briefs/analyze-document`);
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get("file").name, "client-brief.txt");
    assert.equal(options.body.get("parser"), "sample");
    assert.equal(options.body.get("capabilities"), "[]");
    return Response.json(documentScope);
  }),
);
await collect("document-analysis-success", documentAnalysisResponse, 200);

await collect(
  "malformed-json",
  await handlePreviewRequest(makeRequest("{"), makeOptions(async () => {
    throw new Error("malformed JSON must not call an upstream service");
  })),
  400,
);

const oversizedBody = JSON.stringify({ brief: sampleBrief, padding: "x".repeat(100_001) });
await collect(
  "oversized-body",
  await handlePreviewRequest(makeRequest(oversizedBody), makeOptions(async () => {
    throw new Error("oversized requests must not call an upstream service");
  })),
  413,
);

await collect(
  "ai-provider-error",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief, parser: "ai" })), makeOptions(async (url, options) => {
    assert.equal(url, `${briefUrl}/v1/briefs/analyze`);
    assert.equal(JSON.parse(options.body).parser, "ai");
    return Response.json({ detail: "AI session permission is missing." }, { status: 503 });
  })),
  503,
);

await collect(
  "python-error",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief })), makeOptions(async () =>
    Response.json({ detail: "This brief is not supported." }, { status: 422 }),
  )),
  422,
);

await collect(
  "python-timeout-response",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief })), makeOptions(async () =>
    Response.json({ detail: "Service request timed out." }, { status: 504 }),
  )),
  503,
);

await collect(
  "upstream-unavailable",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief })), makeOptions(async () => {
    throw new TypeError("fetch failed");
  })),
  503,
);

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("AbortSignal.timeout did not fire.")), 1000);
    const rejectWithReason = () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    };
    if (signal.aborted) rejectWithReason();
    else signal.addEventListener("abort", rejectWithReason, { once: true });
  });
}

await collect(
  "brief-timeout",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief })), makeOptions(
    async (_url, { signal }) => waitForAbort(signal),
    20,
  )),
  503,
);

const estimateBody = JSON.stringify({ reviewConfirmed: true, scope });
const estimateCalls = [];
const estimateResponse = await handleEstimateConfirmation(
  makeRequest(estimateBody, "/api/v1/preview/estimate"),
  makeOptions(async (url, options) => {
    estimateCalls.push({ url, options });
    assert.equal(url, `${estimatorUrl}/v1/estimates`);
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers["content-type"], "application/json");
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.scope, {
      summary: scope.summary,
      requirements: scope.requirements.map(({ id, title, evidence }) => ({ id, title, evidence })),
      initialAnswers: scope.initialAnswers,
      risks: scope.risks,
      parser: scope.parser,
    });
    assert.deepEqual(payload.answers, scope.initialAnswers);
    assert.equal(payload.historyPolicy, "demo");
    return Response.json(estimate);
  }),
);
assert.equal(estimateCalls.length, 1);
await collect("estimate-success", estimateResponse, 200);

const generalScope = {
  ...scope,
  estimateMode: "general",
  requirements: scope.requirements.map((item, index) => ({ ...item, id: `work-${index + 1}`, complexity: "moderate" })),
};
const generalResponse = await handleEstimateConfirmation(
  makeRequest(JSON.stringify({ reviewConfirmed: true, scope: generalScope }), "/api/v1/preview/estimate"),
  makeOptions(async (url, options) => {
    assert.equal(url, `${estimatorUrl}/v1/estimates/general`);
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.workPackages, generalScope.requirements.map(({ id, title, complexity }) => ({ id, title, complexity })));
    return Response.json(estimate);
  }),
);
await collect("general-estimate-success", generalResponse, 200);

await collect(
  "estimate-unconfirmed",
  await handleEstimateConfirmation(makeRequest(JSON.stringify({ reviewConfirmed: false, scope }), "/api/v1/preview/estimate"), makeOptions(async () => {
    throw new Error("unconfirmed scopes must not call Go");
  })),
  400,
);

const editedQuote = { ...scope, requirements: scope.requirements.map((item, index) => index === 0 ? { ...item, evidence: "Not in the client source" } : item) };
await collect(
  "estimate-invalid-evidence",
  await handleEstimateConfirmation(makeRequest(JSON.stringify({ reviewConfirmed: true, scope: editedQuote }), "/api/v1/preview/estimate"), makeOptions(async () => {
    throw new Error("unsupported evidence must not reach Go");
  })),
  422,
);

await collect(
  "estimator-error",
  await handleEstimateConfirmation(makeRequest(estimateBody, "/api/v1/preview/estimate"), makeOptions(async () =>
    Response.json({ error: "Invalid estimate request." }, { status: 422 }),
  )),
  422,
);

await collect(
  "estimator-timeout",
  await handleEstimateConfirmation(makeRequest(estimateBody, "/api/v1/preview/estimate"), makeOptions(
    async (_url, { signal }) => waitForAbort(signal),
    20,
  )),
  503,
);

process.stdout.write(JSON.stringify(results));
