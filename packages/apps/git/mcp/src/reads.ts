/**
 * com.ikenga.git · MCP — `history.log`, `branch.list`, `worktree.list`,
 * `repo.aheadBehind`: the four read-only tools that are direct one-call (or
 * one-batched-call) wraps over a git-core parser.
 */

import * as argv from '../../core/src/argv.js';
import { run, runTolerant } from '../../core/src/exec.js';
import {
  parseBranchList,
  parseLeftRightCount,
  parseLog,
  parseWorktreeList,
  toAheadBehind,
  toBranchInfo,
} from '../../core/src/parse/index.js';
import type {
  AheadBehind,
  BranchInfo,
  CommitSummary,
  GitError,
  WorktreeInfo,
} from '../../core/src/rpc.js';

export async function historyLog(opts: {
  repo: string;
  ref?: string;
  limit?: number;
  skip?: number;
  path?: string;
}): Promise<{ ok: true; commits: CommitSummary[]; nextSkip: number | null } | GitError> {
  const built = argv.log({ ref: opts.ref, limit: opts.limit, skip: opts.skip, path: opts.path });
  const res = await run('git', built, { cwd: opts.repo });
  if (res.ok !== true) return res;
  const commits = parseLog(res.outcome.stdout);
  // Best-effort pagination cursor: a full page MIGHT mean more history, or
  // might land exactly on the last commit — the caller finds out for certain
  // only when the next page comes back empty. `history.log`'s own doc names
  // this trade-off (rpc.ts `HistoryLogResult.nextSkip`).
  const nextSkip =
    opts.limit !== undefined && commits.length === opts.limit ? (opts.skip ?? 0) + opts.limit : null;
  return { ok: true, commits, nextSkip };
}

export async function branchList(opts: {
  repo: string;
  includeRemote?: boolean;
}): Promise<{ ok: true; branches: BranchInfo[] } | GitError> {
  const built = argv.branchList({ includeRemote: opts.includeRemote });
  const res = await run('git', built, { cwd: opts.repo });
  if (res.ok !== true) return res;
  const parsed = parseBranchList(res.outcome.stdout);

  const branches: BranchInfo[] = [];
  for (const p of parsed) {
    let lastCommit: CommitSummary | null = null;
    if (p.headSha.length > 0) {
      const logBuilt = argv.logCommit({ sha: p.headSha });
      const logRes = await run('git', logBuilt, { cwd: opts.repo });
      if (logRes.ok === true) {
        lastCommit = parseLog(logRes.outcome.stdout)[0] ?? null;
      }
      // A per-branch log failure (e.g. a dangling ref) degrades to
      // `lastCommit: null` rather than failing the whole list — one bad
      // branch must not blank the Branches view.
    }
    branches.push(toBranchInfo(p, lastCommit));
  }
  return { ok: true, branches };
}

export async function worktreeList(opts: {
  repo: string;
}): Promise<{ ok: true; worktrees: WorktreeInfo[] } | GitError> {
  const res = await run('git', argv.worktreeList(), { cwd: opts.repo });
  if (res.ok !== true) return res;
  return { ok: true, worktrees: parseWorktreeList(res.outcome.stdout) };
}

export async function repoAheadBehind(opts: {
  repo: string;
  base: string;
  head?: string;
}): Promise<{ ok: true; counts: AheadBehind } | GitError> {
  const countsRes = await run('git', argv.revListLeftRightCount(opts), { cwd: opts.repo });
  if (countsRes.ok !== true) return countsRes;
  const counts = parseLeftRightCount(countsRes.outcome.stdout);
  if (!counts) {
    return {
      ok: false,
      reason: 'git-failed',
      message: 'rev-list --left-right --count returned unparseable output',
    };
  }

  // `merge-base` exits 1 with NO output for unrelated histories — a real,
  // expected answer (`AheadBehind.mergeBase: null`), not a failure. Tolerant
  // exec is what makes that distinction possible instead of surfacing
  // `git-failed` for two unrelated roots in one repo.
  const mergeBaseBuilt = argv.mergeBase(opts);
  if (mergeBaseBuilt.ok !== true) return mergeBaseBuilt;
  const mergeBaseRes = await runTolerant('git', mergeBaseBuilt, { cwd: opts.repo });
  if (mergeBaseRes.ok !== true) return mergeBaseRes;
  const mergeBaseSha =
    mergeBaseRes.outcome.code === 0 ? mergeBaseRes.outcome.stdout.trim() || null : null;

  return { ok: true, counts: toAheadBehind(opts.base, opts.head ?? 'HEAD', counts, mergeBaseSha) };
}
