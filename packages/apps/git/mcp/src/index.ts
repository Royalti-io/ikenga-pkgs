/**
 * com.ikenga.git — MCP server entry (WP-05).
 *
 * The pkg's ONLY supervised process (`manifest.json#mcp[0]`,
 * `lifecycle: "long-lived"`) — ALSO registered into `~/.claude.json`, so it
 * runs OUTSIDE the shell's kernel gate in any `claude` session's cwd. See
 * `plans/git/01-plan.md` §MCP threat model.
 *
 * Two jobs, cleanly separated:
 *
 *   1. **The frozen G-MCP tool surface** (`tools.ts`) — 6 read tools +
 *      `git_commit`, every one taking an explicit `repo` resolved against
 *      known project roots (`repo-resolve.ts`) and refused outside them.
 *
 *   2. **The `repo.changed` watcher** (`watcher.ts` + `known-repos.ts`) — the
 *      re-scoped D7 "push now": this process owns the ONLY fs-watcher in the
 *      pkg (the sidecar is one-shot and stateless per WP-04's re-scope), and
 *      forwards a coalesced `repo.changed` per repo per window as a
 *      `notifications/message` frame via `sendLoggingMessage`. The shell's
 *      existing MCP-notification relay (`MCP_NOTIFICATION_EVENT`, 20/s
 *      tumbling cap — `lifecycle.rs:148-166`) carries it into the pkg
 *      iframe; the watcher itself is NOT a tool and appears nowhere in
 *      `ListTools`.
 *
 * Logs go to stderr only — stdout is the MCP stdio transport, exactly like
 * every sibling server in this monorepo (`mcp-iyke`, studio's `studio-mcp`).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { TOOLS } from './tools.js';
import { RepoWatcher } from './watcher.js';
import { listKnownRepos } from './known-repos.js';
import type { RepoChangedParams } from '../../core/src/rpc.js';

const NAME = 'git';
const VERSION = '0.1.0';

/** How often the watcher re-polls the known-project-root set and rescans for
 *  new/removed nested repos. Not the fs-change latency (that's the debounce
 *  ceiling in `watcher.ts`, ~1s) — this is "did the USER add a project or a
 *  fresh clone", which changes far less often. */
const RECONCILE_INTERVAL_MS = 30_000;

const byName = new Map(TOOLS.map((t) => [t.name, t]));

async function main(): Promise<void> {
  const server = new Server(
    { name: NAME, version: VERSION },
    { capabilities: { tools: {}, logging: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as never,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = byName.get(name as (typeof TOOLS)[number]['name']);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    try {
      const result = await tool.handler((args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        // Mirror the studio-mcp / iyke-mcp pattern: a structured
        // `{ok:false, reason}` failure surfaces as a normal tool result with
        // `isError: true`, so the calling agent can read WHY and decide what
        // to do — never a bare protocol error for an ordinary git failure.
        isError: result.ok === false,
      };
    } catch (err) {
      if (err instanceof McpError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, reason: 'internal', message: msg }) },
        ],
        isError: true,
      };
    }
  });

  // ── the watcher ────────────────────────────────────────────────────────
  const watcher = new RepoWatcher((params: RepoChangedParams) => {
    void server
      .sendLoggingMessage({
        level: 'info',
        logger: 'git-mcp/watcher',
        // The relay forwards `notifications/message` frames' `params`
        // VERBATIM to the pkg iframe (`lifecycle.rs:160`); `data` is where
        // `sendLoggingMessage` puts the caller's payload. So the iframe sees
        // `{pkg_id, method:'notifications/message', params:{level, logger,
        // data:{method:'repo.changed', params}}}` — `readRepoChangedParams`
        // (WP-12, `@ikenga/contract/app-bridge`) is what demuxes that.
        data: { method: 'repo.changed', params },
      })
      .catch((err: Error) => {
        process.stderr.write(`[git-mcp] failed to send repo.changed: ${err.message}\n`);
      });
  });

  async function reconcile(): Promise<void> {
    try {
      const repos = await listKnownRepos();
      await watcher.reconcile(repos);
    } catch (err) {
      // A reconcile failure (iyke bridge down, a transient fs error) must
      // never crash the supervised process — the previous watch set just
      // stays in place until the next tick.
      process.stderr.write(`[git-mcp] reconcile failed: ${(err as Error).message}\n`);
    }
  }

  await reconcile();
  const reconcileTimer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();

  process.stderr.write(`[git-mcp] ready name=${NAME} pid=${String(process.pid)}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (sig: string): Promise<void> => {
    process.stderr.write(`[git-mcp] received ${sig}, shutting down\n`);
    clearInterval(reconcileTimer);
    try {
      await watcher.stop();
    } catch {
      /* ignore */
    }
    try {
      await server.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  process.stderr.write(`[git-mcp] fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
