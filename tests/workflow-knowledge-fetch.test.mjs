import test from "node:test";
import assert from "node:assert/strict";
import { fetchApprovedKnowledgeSource, isPublicAddress, normalizeKnowledgeDomain, resolvePublicKnowledgeHost, validateKnowledgeSourceUrl } from "../lib/workflow-knowledge-fetch.ts";
import { searchApprovedKnowledge } from "../lib/workflow-knowledge.ts";

const publicHost = "docs.example.org";

test("knowledge source domains must be public exact hostnames", () => {
  assert.equal(normalizeKnowledgeDomain(" DOCS.Example.org "), publicHost);
  for (const value of ["localhost", "service.internal", "example.com/path", "*.example.org", "127.0.0.1", "192.168.1.1", "example.org:8443"]) {
    assert.throws(() => normalizeKnowledgeDomain(value), undefined, value);
  }
});

test("public-address checks reject special IPv4 and IPv6 networks", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "100.64.1.2", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.5", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "2001:10::1", "2001:20::1", "2002:7f00:1::1", "3fff::1"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
});

test("DNS preflight requires public A and AAAA answers", async () => {
  const fetcher = async request => {
    const type = new URL(request).searchParams.get("type");
    const answer = type === "A" ? [{ type: 1, data: "10.0.0.8" }] : [{ type: 28, data: "2606:4700:4700::1111" }];
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "Content-Type": "application/dns-json" } });
  };
  await assert.rejects(() => resolvePublicKnowledgeHost(publicHost, fetcher), /private or reserved/);
});

test("source URLs require HTTPS and an exact company-approved hostname", () => {
  assert.equal(validateKnowledgeSourceUrl("https://docs.example.org/a#section", [publicHost]).toString(), "https://docs.example.org/a");
  for (const value of ["http://docs.example.org/", "https://user:pass@docs.example.org/", "https://docs.example.org:444/", "https://other.example.org/"]) {
    assert.throws(() => validateKnowledgeSourceUrl(value, [publicHost]));
  }
});

test("fetch adapter rejects redirect responses and unsupported content types", async () => {
  const resolver = async () => ["8.8.8.8"];
  const redirectFetcher = async () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example.org/" } });
  await assert.rejects(() => fetchApprovedKnowledgeSource("https://docs.example.org/guide", [publicHost], { resolveHost: resolver, fetcher: redirectFetcher }), /redirect/i);
  const imageFetcher = async () => new Response("bytes", { status: 200, headers: { "Content-Type": "image/png" } });
  await assert.rejects(() => fetchApprovedKnowledgeSource("https://docs.example.org/guide", [publicHost], { resolveHost: resolver, fetcher: imageFetcher }), /Only HTML/);
});

test("fetch adapter strips executable HTML, captures metadata, and hashes extracted text", async () => {
  const html = "<html><head><title>Investor API</title><script>ignore me</script></head><body><h1>Integration guide</h1><p>Connect the investor registry through the supported API and review access before enabling synchronization.</p><style>hide me</style></body></html>";
  const fetcher = async () => new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  const now = () => new Date("2026-10-19T10:00:00.000Z");
  const result = await fetchApprovedKnowledgeSource("https://docs.example.org/guide", [publicHost], { resolveHost: async () => ["8.8.8.8"], fetcher, now });
  assert.equal(result.title, "Investor API");
  assert.equal(result.retrievedAt, "2026-10-19T10:00:00.000Z");
  assert.equal(result.url, "https://docs.example.org/guide");
  assert.match(result.text, /Integration guide/);
  assert.doesNotMatch(result.text, /ignore me|hide me/);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.truncated, false);
});

test("fetch adapter rejects private DNS answers and oversized pages", async () => {
  const neverFetch = async () => { throw new Error("must not fetch"); };
  await assert.rejects(() => fetchApprovedKnowledgeSource("https://docs.example.org/guide", [publicHost], { resolveHost: async () => ["10.1.2.3"], fetcher: neverFetch }), /private or reserved/);
  const large = async () => new Response("x".repeat(1_000_001), { status: 200, headers: { "Content-Type": "text/plain" } });
  await assert.rejects(() => fetchApprovedKnowledgeSource("https://docs.example.org/guide", [publicHost], { resolveHost: async () => ["8.8.8.8"], fetcher: large }), /1 MB download limit/);
});

test("knowledge search exposes saved retrieval metadata only for approved versions", () => {
  const sources = [
    { id: "approved", title: "Public guide", url: "https://docs.example.org/guide", text: "Approved source evidence for integration workflow.", status: "approved", sha256: "legacy-digest", addedAt: "2026-10-01T00:00:00.000Z" },
    { id: "draft", title: "Pending guide", url: "https://docs.example.org/draft", text: "Draft source evidence for integration workflow.", status: "draft", sha256: "draft-digest", addedAt: "2026-10-02T00:00:00.000Z" },
  ];
  const passages = searchApprovedKnowledge(sources, "integration workflow", { approved: { retrievedAt: "2026-10-03T00:00:00.000Z", sha256: "fetched-digest" } });
  assert.equal(passages.length, 1);
  assert.equal(passages[0].sourceId, "approved");
  assert.equal(passages[0].retrievedAt, "2026-10-03T00:00:00.000Z");
  assert.equal(passages[0].sha256, "fetched-digest");
});
