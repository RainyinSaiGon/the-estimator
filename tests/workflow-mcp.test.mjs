import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKnowledgeServer } from "../apps/web/lib/knowledge-mcp-server.ts";

test("MCP client discovers read-only tools and cannot fetch unapproved company sources", async () => {
  const approvedId = "10000000-0000-4000-8000-000000000001";
  const draftId = "10000000-0000-4000-8000-000000000002";
  const base = { title: "Synthetic company guide", text: "Approved company workflow evidence.", url: "https://docs.example.com/guide", sha256: "fixture", retrievedAt: "2026-10-19T00:00:00Z" };
  const documents = [{ ...base, id: approvedId, status: "approved" }, { ...base, id: draftId, status: "draft" }];
  const server = createKnowledgeServer("test-company", documents, async () => ({ passages: [
    { sourceId: approvedId, passage: base.text }, { sourceId: draftId, passage: "Unapproved content" },
  ] }));
  const client = new Client({ name: "workflow-integration-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(item => item.name).sort(), ["knowledge_fetch", "knowledge_search"]);
    assert.ok(tools.tools.every(item => item.annotations.readOnlyHint));
    const search = await client.callTool({ name: "knowledge_search", arguments: { query: "workflow" } });
    assert.equal(JSON.parse(search.content[0].text).passages.length, 1);
    const denied = await client.callTool({ name: "knowledge_fetch", arguments: { sourceId: draftId } });
    assert.equal(denied.isError, true);
    const resources = await client.listResources();
    assert.equal(resources.resources.length, 1);
    const source = await client.readResource({ uri: resources.resources[0].uri });
    assert.equal(source.contents[0].text, base.text);
  } finally { await client.close(); await server.close(); }
});
