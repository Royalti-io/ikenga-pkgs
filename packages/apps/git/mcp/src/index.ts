/**
 * com.ikenga.git — MCP server entry (WP-02 scaffold stub).
 *
 * Stateless MCP over stdio, spawned by the kernel per
 * `manifest.json#mcp[0]` AND registered into `~/.claude.json` (runs OUTSIDE
 * the shell — see §MCP threat model in `plans/git/01-plan.md`). This stub
 * exposes a single `ping` smoke-test tool to prove the process boots and
 * speaks MCP over stdio without crashing.
 *
 * The frozen v1 tool surface (G-MCP, signed off) —
 *   read:     git_status, git_diff, git_log, git_branch_list,
 *             git_worktree_list, git_ahead_behind
 *   mutating: git_commit(repo, paths[], message)  — the ONLY mutating tool
 * — lands in WP-05 over `git-core` (WP-03), with every tool taking an
 * explicit `repo` resolved against known project roots via iyke and refused
 * outside them. Never-expose list: push, reset --hard, clean, discard,
 * branch -D, worktree remove, stash drop, rebase, filter-branch, any `gh`
 * write.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'git',
  version: '0.1.0',
});

server.tool(
  'ping',
  'Smoke-test tool — returns "pong". Placeholder until WP-05 lands the git_* tool surface.',
  { message: z.string().optional() },
  async ({ message }) => ({
    content: [
      {
        type: 'text',
        text: `pong${message ? `: ${message}` : ''}`,
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
