import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as z from "zod/v4";
import { AuthStore } from "../src/auth-store.js";
import { McpClients } from "../src/client.js";
import { resolveConfig } from "../src/config.js";
import { EMPTY_GLOBAL_CONFIG } from "../src/model.js";

async function mockServer() {
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.post("/mcp", async (request: Request, response: Response) => {
    const server = new McpServer({ name: "test", version: "1" });
    server.registerTool("echo", { description: "Echo text", inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text", text }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    response.on("close", () => { void transport.close(); void server.close(); });
  });
  const http = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
    value.on("error", reject);
  });
  return { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, close: () => new Promise<void>(resolve => http.close(() => resolve())) };
}

test("Streamable HTTP client discovers and calls MCP tools", async () => {
  const server = await mockServer();
  const clients = new McpClients(await AuthStore.open("unused"), {}, new URL("http://127.0.0.1:33418/callback"), () => undefined);
  try {
    const config = resolveConfig({ ...EMPTY_GLOBAL_CONFIG, servers: { test: { url: server.url } } }).servers.test!;
    const tools = await clients.refresh("test", config);
    assert.deepEqual(tools.map(tool => tool.name), ["echo"]);
    const result = await clients.call("test", config, "echo", { text: "hello" });
    assert.equal("content" in result && Array.isArray(result.content) && result.content[0]?.type === "text" ? result.content[0].text : undefined, "hello");
  } finally {
    await clients.close();
    await server.close();
  }
});

test("client activity records unavailable servers", async () => {
  const updates: Array<{ serverId: string; checking: boolean; failed: boolean }> = [];
  const clients = new McpClients(await AuthStore.open("unused"), {}, new URL("http://127.0.0.1:33418/callback"), () => undefined, (serverId, activity) => updates.push({ serverId, ...activity }));
  const config = resolveConfig({ ...EMPTY_GLOBAL_CONFIG, servers: { test: { url: "http://127.0.0.1:1/mcp" } } }).servers.test!;

  await assert.rejects(clients.refresh("test", config));
  assert.deepEqual(clients.activity("test"), { checking: false, failed: true });
  assert.deepEqual(updates, [
    { serverId: "test", checking: true, failed: false },
    { serverId: "test", checking: false, failed: true },
  ]);
});
