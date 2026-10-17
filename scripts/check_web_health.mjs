import assert from "node:assert/strict";
import { GET as live } from "../apps/web/app/health/live/route.ts";
import { GET as ready } from "../apps/web/app/health/ready/route.ts";

const originalInfo = console.info;
const originalError = console.error;
const logs = [];
console.info = line => logs.push(line);
console.error = line => logs.push(line);

try {
  const liveResponse = await live(new Request("http://localhost/health/live?token=do-not-log", {
    headers: { "x-request-id": "00000000-0000-4000-8000-000000000002" },
  }));
  assert.equal(liveResponse.status, 200);
  assert.equal(liveResponse.headers.get("x-request-id"), "00000000-0000-4000-8000-000000000002");
  assert.deepEqual(await liveResponse.json(), { status: "ok" });

  const readyResponse = await ready(new Request("http://localhost/health/ready", {
    headers: { "x-request-id": "00000000-0000-4000-8000-000000000003" },
  }));
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(await readyResponse.json(), { status: "ready", service: "web" });

  process.env.BRIEF_SERVICE_URL = "http://user:secret@127.0.0.1:8001";
  const unavailableResponse = await ready(new Request("http://localhost/health/ready", {
    headers: { "x-request-id": "this-is-not-a-request-id-secret" },
  }));
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), { status: "not_ready", service: "web" });

  assert.ok(logs.every(line => !line.includes("do-not-log") && !line.includes("secret")));
  const events = logs.filter(line => line.trimStart().startsWith("{")).map(line => JSON.parse(line));
  assert.equal(events.length, 3);
  assert.ok(events.every(event => event.service === "web" && event.event === "http_request"));
  assert.ok(events.every(event => typeof event.duration_ms === "number"));
  assert.ok(events.every(event => !JSON.stringify(event).includes("do-not-log")));
  assert.ok(events.every(event => !JSON.stringify(event).includes("secret")));
  process.stdout.write(JSON.stringify([
    { name: "web-live", status: liveResponse.status, body: { status: "ok" } },
    { name: "web-ready", status: readyResponse.status, body: { status: "ready", service: "web" } },
    { name: "web-not-ready", status: unavailableResponse.status, body: { status: "not_ready", service: "web" } },
  ]));
} finally {
  console.info = originalInfo;
  console.error = originalError;
}
