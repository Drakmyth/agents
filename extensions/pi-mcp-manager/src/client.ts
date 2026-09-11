import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { ResolvedServer, CachedTool, CredentialProfile } from "./model.js";
import { resolveHeaders } from "./credentials.js";
import { AuthStore } from "./auth-store.js";
import { PersistentOAuthProvider } from "./oauth.js";

interface Connection { client: Client; transport: StreamableHTTPClientTransport; secrets: string[] }

export class McpClients {
  private readonly connections = new Map<string, Connection>();
  constructor(
    private readonly auth: AuthStore,
    private readonly profiles: Record<string, CredentialProfile>,
    private readonly redirectUrl: URL,
    private readonly onOAuthRedirect: (serverId: string, url: URL) => void | Promise<void>,
  ) {}

  createOAuthProvider(serverId: string): PersistentOAuthProvider {
    return new PersistentOAuthProvider(serverId, this.auth, this.redirectUrl, url => this.onOAuthRedirect(serverId, url));
  }

  async connect(serverId: string, server: ResolvedServer, signal?: AbortSignal): Promise<Connection> {
    const existing = this.connections.get(serverId);
    if (existing) return existing;
    const { headers, secrets } = await resolveHeaders(server.headers, this.profiles, signal);
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers },
      authProvider: server.oauth ? this.createOAuthProvider(serverId) : undefined,
    });
    const client = new Client({ name: "pi-mcp-manager", version: "0.1.0" });
    try {
      await client.connect(transport, { signal });
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
    const connection = { client, transport, secrets };
    transport.onclose = () => this.connections.delete(serverId);
    this.connections.set(serverId, connection);
    return connection;
  }

  async login(serverId: string, server: ResolvedServer, receiveCode: Promise<{ code: string; state: string | null }>, signal?: AbortSignal): Promise<void> {
    await this.disconnect(serverId);
    const provider = this.createOAuthProvider(serverId);
    const { headers } = await resolveHeaders(server.headers, this.profiles, signal);
    const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers }, authProvider: provider });
    const client = new Client({ name: "pi-mcp-manager", version: "0.1.0" });
    try {
      await client.connect(transport, { signal });
      await transport.close();
      return;
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) { await transport.close().catch(() => undefined); throw error; }
    }
    const callback = await receiveCode;
    if (!provider.verifyState(callback.state)) throw new Error("OAuth callback state did not match");
    await transport.finishAuth(callback.code);
    await transport.close().catch(() => undefined);
    await this.connect(serverId, server, signal);
  }

  async refresh(serverId: string, server: ResolvedServer, signal?: AbortSignal): Promise<CachedTool[]> {
    const { client } = await this.connect(serverId, server, signal);
    const tools: CachedTool[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined, { signal });
      tools.push(...result.tools.map(tool => ({ name: tool.name, title: tool.annotations?.title, description: tool.description, inputSchema: tool.inputSchema })));
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async call(serverId: string, server: ResolvedServer, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    try {
      const { client } = await this.connect(serverId, server, signal);
      return await client.callTool({ name, arguments: args }, undefined, { signal });
    } catch (error) {
      await this.disconnect(serverId);
      throw error;
    }
  }

  isConnected(serverId: string): boolean { return this.connections.has(serverId); }
  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    this.connections.delete(serverId);
    if (connection) await connection.transport.close().catch(() => undefined);
  }
  async close(): Promise<void> { await Promise.all([...this.connections.keys()].map(id => this.disconnect(id))); }
}
