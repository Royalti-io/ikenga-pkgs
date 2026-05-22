/**
 * com.ikenga.studio — MCP server entry.
 *
 * Bundled by `bun build --target=node --format=esm` (see ./build.sh). Boots
 * an MCP server over stdio, spawns the project sidecar as a child process,
 * wires the tool registry, and forwards sidecar `event` notifications to
 * the MCP client via `logging/message` (the per-event topic is encoded in
 * the message body).
 *
 * Lifecycle:
 *   • SIGINT/SIGTERM → graceful shutdown (stop sidecar, close transport).
 *   • stdin EOF (MCP transport closed) → same shutdown path.
 *   • Sidecar child exit → auto-respawn (up to 3 attempts, exponential backoff).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { SidecarClient } from './sidecar-client.js';
import { Catalog } from './catalog.js';
import { buildTools } from './tools/index.js';
import type { OpenProjectRegistry, OpenProjectEntry } from './tools/types.js';

const NAME = 'studio-mcp';
const VERSION = '0.0.0';

// ─────────────────────────────────────────────────────────────────────────
// Simple in-MCP open-project registry
// ─────────────────────────────────────────────────────────────────────────

class InMemoryRegistry implements OpenProjectRegistry {
  private map = new Map<string, OpenProjectEntry>();
  set(projectId: string, entry: OpenProjectEntry): void { this.map.set(projectId, entry); }
  get(projectId: string): OpenProjectEntry | undefined { return this.map.get(projectId); }
  delete(projectId: string): boolean { return this.map.delete(projectId); }
  values(): IterableIterator<OpenProjectEntry> { return this.map.values(); }
  keys(): IterableIterator<string> { return this.map.keys(); }
}

// ─────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sidecar = new SidecarClient();
  const catalog = new Catalog();
  const registry = new InMemoryRegistry();

  // Boot sidecar eagerly so the smoke test can ps for it.
  sidecar.start();

  const tools = buildTools({ sidecar, catalog, registry });
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: NAME, version: VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as never,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = byName.get(name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    try {
      const result = await tool.handler((args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        // Mirror the iyke-mcp pattern: ok:false results surface as normal
        // tool results with isError=true so the agent can read them.
        isError: result.ok === false,
      };
    } catch (err) {
      if (err instanceof McpError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'internal-error', message: msg }) }],
        isError: true,
      };
    }
  });

  // Forward sidecar events to the MCP client as logging messages. The topic
  // + projectId travel in the JSON body so consumers can demultiplex.
  sidecar.onEvent((evt) => {
    void server.sendLoggingMessage({
      level: 'info',
      logger: 'studio-mcp/sidecar-event',
      data: evt,
    }).catch((err: Error) => {
      // Logging-message send can fail before the client finishes initialize();
      // we never want to crash the server on that path.
      process.stderr.write(`[studio-mcp] failed to forward event: ${err.message}\n`);
    });
  });

  // Boot banner (stderr only — stdout is the MCP transport).
  process.stderr.write(`[studio-mcp] ready name=${NAME} pid=${process.pid}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown.
  const shutdown = async (sig: string) => {
    process.stderr.write(`[studio-mcp] received ${sig}, shutting down\n`);
    try { await sidecar.stop(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  process.stderr.write(`[studio-mcp] fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
