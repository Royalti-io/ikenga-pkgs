/**
 * com.ikenga.git · MCP — the frozen G-MCP tool surface, and nothing else.
 *
 * "v1 read tools: git_status, git_diff, git_log, git_branch_list,
 * git_worktree_list, git_ahead_behind. v1 mutating tools: exactly one —
 * git_commit(repo, paths[], message)." (01-plan.md §MCP threat model, signed
 * off Round 2). `assertMcpSurface()` (git-core, from the frozen `rpc.ts`)
 * fails at import time — before any tool can be called — if this file's
 * `TOOLS` array ever drifts from that list; `tools.test.ts` also asserts it
 * directly so the drift is caught by `npm test`, not only at runtime.
 *
 * Every handler below follows the same four steps, in order:
 *   1. Validate raw args against the FROZEN `RpcSpec[method].args` Zod
 *      schema — the same schema the sidecar and the UI validate against, so
 *      a caller who tries option injection through this MCP gets classified
 *      exactly the way `argv.test.ts` (verification 6) expects: as
 *      `unsafe-argument`, never flattened into `invalid-args`.
 *   2. Resolve + authorize `repo` via `repo-resolve.ts` (G-04) — a `repo`
 *      outside every known Ikenga project root is refused before git-core
 *      ever sees it.
 *   3. Call the matching git-core-backed handler.
 *   4. Re-validate the RESPONSE against `RpcSpec[method].result` before
 *      returning it. This is not defensive theatre: it is what makes "the
 *      MCP exposes exactly what the contract says" a property this file
 *      checks on every call, not only in a test that will go stale.
 */

import {
  RpcSpec,
  assertMcpSurface,
  isGitError,
  MCP_TOOLS,
  type GitError,
  type McpTool,
} from '../../core/src/rpc.js';
import { fromZodError } from '../../core/src/errors.js';
import { resolveRepo } from './repo-resolve.js';
import { buildRepoSnapshot } from './repo-snapshot.js';
import { buildFileDiff } from './diff.js';
import { branchList, historyLog, repoAheadBehind, worktreeList } from './reads.js';
import { commitCreate } from './commit.js';

// Fails fast at process boot if `TOOLS` (below) ever drifts from the frozen
// G-MCP list — see module doc.
assertMcpSurface();

export interface McpToolDef {
  name: McpTool;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (rawArgs: Record<string, unknown>) => Promise<{ ok: boolean } & Record<string, unknown>>;
}

/** Every tool takes `repo` — an absolute git toplevel, resolved against known
 *  project roots (G-04). Spelled out once and spread into each schema so a
 *  new tool cannot forget the field. */
const REPO_PROP = {
  repo: {
    type: 'string',
    description:
      'Absolute path to a git repository toplevel. Must be inside a project root the running Ikenga desktop app knows about; refused otherwise.',
  },
} as const;

async function validated<M extends keyof typeof RpcSpec>(
  method: M,
  rawArgs: Record<string, unknown>
): Promise<{ ok: true; args: unknown } | GitError> {
  const parsed = RpcSpec[method].args.safeParse(rawArgs);
  if (!parsed.success) return fromZodError(parsed.error);
  return { ok: true, args: parsed.data };
}

/** Parse the response through the frozen result schema before it leaves this
 *  process — see module doc point 4. Throws on a real construction bug
 *  (caught by the caller in `index.ts` and turned into an `internal`
 *  `GitError` rather than crashing the supervised process). */
function assembled<M extends keyof typeof RpcSpec>(
  method: M,
  value: unknown
): { ok: boolean } & Record<string, unknown> {
  return RpcSpec[method].result.parse(value) as { ok: boolean } & Record<string, unknown>;
}

export const TOOLS: readonly McpToolDef[] = [
  {
    name: 'git_status',
    description:
      RpcSpec['repo.snapshot'].summary +
      ' Explicit `repo` only — there is no ambient "current repo".',
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PROP },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const v = await validated('repo.snapshot', raw);
      if (!v.ok) return assembled('repo.snapshot', v);
      const args = v.args as { repo: string };
      const resolved = await resolveRepo(args.repo);
      if (!resolved.ok) return assembled('repo.snapshot', resolved);
      const snap = await buildRepoSnapshot(resolved.resolved.repo, resolved.resolved.relPath);
      return assembled('repo.snapshot', snap);
    },
  },
  {
    name: 'git_diff',
    description: RpcSpec['changes.diff'].summary,
    inputSchema: {
      type: 'object',
      properties: {
        ...REPO_PROP,
        path: { type: 'string', description: 'Repo-relative path.' },
        side: { type: 'string', enum: ['staged', 'unstaged', 'commit'] },
        sha: { type: 'string', description: 'Required iff side is "commit".' },
        contextLines: { type: 'integer', minimum: 0, maximum: 100 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 10_000_000 },
      },
      required: ['repo', 'path', 'side'],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const v = await validated('changes.diff', raw);
      if (!v.ok) return assembled('changes.diff', v);
      const args = v.args as {
        repo: string;
        path: string;
        side: 'staged' | 'unstaged' | 'commit';
        sha?: string;
        contextLines?: number;
        maxBytes?: number;
      };
      const resolved = await resolveRepo(args.repo);
      if (!resolved.ok) return assembled('changes.diff', resolved);
      const diff = await buildFileDiff({ ...args, repo: resolved.resolved.repo });
      return assembled('changes.diff', diff);
    },
  },
  {
    name: 'git_log',
    description: RpcSpec['history.log'].summary,
    inputSchema: {
      type: 'object',
      properties: {
        ...REPO_PROP,
        ref: { type: 'string', description: 'Defaults to HEAD.' },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
        skip: { type: 'integer', minimum: 0 },
        path: { type: 'string', description: 'Restrict to commits touching this path.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const v = await validated('history.log', raw);
      if (!v.ok) return assembled('history.log', v);
      const args = v.args as {
        repo: string;
        ref?: string;
        limit?: number;
        skip?: number;
        path?: string;
      };
      const resolved = await resolveRepo(args.repo);
      if (!resolved.ok) return assembled('history.log', resolved);
      const res = await historyLog({ ...args, repo: resolved.resolved.repo });
      if (!res.ok) return assembled('history.log', res);
      return assembled('history.log', {
        ok: true,
        repo: resolved.resolved.repo,
        commits: res.commits,
        nextSkip: res.nextSkip,
      });
    },
  },
  {
    name: 'git_branch_list',
    description: RpcSpec['branch.list'].summary,
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PROP, includeRemote: { type: 'boolean' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const v = await validated('branch.list', raw);
      if (!v.ok) return assembled('branch.list', v);
      const args = v.args as { repo: string; includeRemote?: boolean };
      const resolved = await resolveRepo(args.repo);
      if (!resolved.ok) return assembled('branch.list', resolved);
      const res = await branchList({ ...args, repo: resolved.resolved.repo });
      if (!res.ok) return assembled('branch.list', res);
      return assembled('branch.list', {
        ok: true,
        repo: resolved.resolved.repo,
        branches: res.branches,
      });
    },
  },
  {
    name: 'git_worktree_list',
    description: RpcSpec['worktree.list'].summary,
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PROP },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const v = await validated('worktree.list', raw);
      if (!v.ok) return assembled('worktree.list', v);
      const args = v.args as { repo: string };
      const resolved = await resolveRepo(args.repo);
      if (!resolved.ok) return assembled('worktree.list', resolved);
      const res = await worktreeList({ repo: resolved.resolved.repo });
      if (!res.ok) return assembled('worktree.list', res);
      return assembled('worktree.list', {
        ok: true,
        repo: resolved.resolved.repo,
        worktrees: res.worktrees,
      });
    },
  },
  {
    name: 'git_ahead_behind',
    description: RpcSpec['repo.aheadBehind'].summary,
    inputSchema: {
      type: 'object',
      properties: {
        ...REPO_PROP,
        base: { type: 'string', description: 'e.g. main, origin/main.' },
        head: { type: 'string', description: 'Defaults to HEAD.' },
      },
      required: ['repo', 'base'],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const v = await validated('repo.aheadBehind', raw);
      if (!v.ok) return assembled('repo.aheadBehind', v);
      const args = v.args as { repo: string; base: string; head?: string };
      const resolved = await resolveRepo(args.repo);
      if (!resolved.ok) return assembled('repo.aheadBehind', resolved);
      const res = await repoAheadBehind({ ...args, repo: resolved.resolved.repo });
      return assembled('repo.aheadBehind', res);
    },
  },
  {
    name: 'git_commit',
    description:
      RpcSpec['commit.create'].summary +
      ' `paths` must be non-empty — unlike the UI, this tool never commits "whatever is already staged".',
    inputSchema: {
      type: 'object',
      properties: {
        ...REPO_PROP,
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Repo-relative paths to commit. Stages nothing implicitly.',
        },
        message: { type: 'string', minLength: 1 },
      },
      required: ['repo', 'paths', 'message'],
      additionalProperties: false,
    },
    handler: async (raw) => {
      // `CommitCreateArgs.paths` allows an empty array (the UI's "commit
      // what's staged"); this tool's own schema forbids it (Q3) — enforced
      // BEFORE the shared Zod schema runs, so an MCP caller sending `[]`
      // never reaches the shared "empty means staged" semantics at all.
      const rawPaths = raw.paths;
      if (Array.isArray(rawPaths) && rawPaths.length === 0) {
        return assembled('commit.create', {
          ok: false,
          reason: 'unsafe-argument',
          message: 'git_commit requires at least one explicit path',
          path: 'paths',
        });
      }
      const v = await validated('commit.create', raw);
      if (!v.ok) return assembled('commit.create', v);
      const args = v.args as { repo: string; paths: string[]; message: string };
      const resolved = await resolveRepo(args.repo);
      if (!resolved.ok) return assembled('commit.create', resolved);
      const res = await commitCreate({
        repo: resolved.resolved.repo,
        relPath: resolved.resolved.relPath,
        paths: args.paths,
        message: args.message,
      });
      if (!res.ok) return assembled('commit.create', res);
      return assembled('commit.create', { ok: true, ...res.result });
    },
  },
];

// Compile-time + runtime cross-check that `TOOLS`' names are exactly
// `MCP_TOOLS` — belt to `assertMcpSurface()`'s suspenders, and what
// `tools.test.ts` imports directly.
export function assertToolNamesMatchFrozenList(): void {
  const names = TOOLS.map((t) => t.name).sort();
  const frozen = [...MCP_TOOLS].sort();
  if (names.length !== frozen.length || names.some((n, i) => n !== frozen[i])) {
    throw new Error(
      `G-MCP drift: TOOLS=[${names.join(',')}] !== MCP_TOOLS=[${frozen.join(',')}]`
    );
  }
}
assertToolNamesMatchFrozenList();

export { isGitError };
