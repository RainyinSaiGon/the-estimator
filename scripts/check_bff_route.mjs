import assert from "node:assert/strict";
import { handlePreviewRequest } from "../apps/web/app/api/v1/preview/preview-handler.ts";

const briefUrl = "http://brief.test";
const estimatorUrl = "http://estimator.test";
const sampleBrief = "Import customer records and connect the CRM systems for a nightly synchronization.";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { scope, estimate } = JSON.parse(input);

function makeRequest(body) {
  return new Request("http://estimator.test/api/v1/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function makeOptions(fetchImpl, timeoutMs = 1000) {
  return { fetchImpl, timeoutMs, briefUrl, estimatorUrl };
}

const results = [];

async function collect(name, response, expectedStatus) {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${name} returned an unexpected HTTP status`);
  results.push({ name, status: response.status, body });
}

const successCalls = [];
const successResponse = await handlePreviewRequest(
  makeRequest(JSON.stringify({ brief: sampleBrief })),
  makeOptions(async (url, options) => {
    successCalls.push({ url, options });
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers["content-type"], "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    if (url === `${briefUrl}/v1/briefs/analyze`) return Response.json(scope);
    assert.equal(url, `${estimatorUrl}/v1/estimates`);
    const request = JSON.parse(options.body);
    assert.deepEqual(request.scope, scope);
    assert.deepEqual(request.answers, scope.initialAnswers);
    assert.equal(request.historyPolicy, "demo");
    return Response.json(estimate);
  }),
);
assert.equal(successCalls.length, 2, "success must call both upstream services");
assert.equal(successResponse.headers.get("cache-control"), "no-store");
await collect("success", successResponse, 200);

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
  "ai-unconfigured",
  await handlePreviewRequest(
    makeRequest(JSON.stringify({ brief: sampleBrief, parser: "ai" })),
    makeOptions(async () => {
      throw new Error("AI-unconfigured response must not call an upstream service");
    }),
  ),
  503,
);

await collect(
  "python-error",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief })), makeOptions(async () =>
    Response.json({ detail: "This brief is not supported." }, { status: 422 }),
  )),
  422,
);

let estimatorCallCount = 0;
await collect(
  "estimator-error",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief })), makeOptions(async (url) => {
    if (url === `${briefUrl}/v1/briefs/analyze`) return Response.json(scope);
    estimatorCallCount += 1;
    return Response.json({ error: "Invalid estimate request." }, { status: 422 });
  })),
  422,
);
assert.equal(estimatorCallCount, 1);

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

await collect(
  "estimator-timeout",
  await handlePreviewRequest(makeRequest(JSON.stringify({ brief: sampleBrief })), makeOptions(
    async (url, { signal }) => {
      if (url === `${briefUrl}/v1/briefs/analyze`) return Response.json(scope);
      return waitForAbort(signal);
    },
    20,
  )),
  503,
);

process.stdout.write(JSON.stringify(results));
