/**
 * com.ikenga.git · MCP — assemble a `RepoSnapshot` (the `git_status` tool).
 *
 * `RepoSnapshot` is deliberately the richest single read in the contract
 * (rpc.ts §3.6): branch/upstream/ahead-behind, dirty counts, stash, an
 * in-progress-operation guard, the last commit, worktrees, and nested repos.
 * This module is the one place all of those spawns/reads are assembled, so a
 * caller — here, the `git_status` MCP tool — makes exactly the calls it
 * needs and no more.
 *
 * Two pieces git-core's parsers do NOT cover, both implemented here:
 *   · `gitDir` / `isBare`     — `rev-parse` interrogatives, not parsed output.
 *   · `operation`             — read from `.git` state FILES, not a git
 *                               subcommand at all (no porcelain surfaces
 *                               "mid-rebase" as a status line).
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import * as argv from '../../core/src/argv.js';
import { run } from '../../core/src/exec.js';
import { describeNested, scanForRepos } from '../../core/src/discover.js';
import {
  countChanges,
  parseLog,
  parseStatus,
  parseWorktreeList,
} from '../../core/src/parse/index.js';
import type { GitError, RepoOperation, RepoSnapshot } from '../../core/src/rpc.js';

/** Files/dirs under `.git` (or a linked worktree's private git-dir) whose
 *  presence names an in-progress sequenced operation. Order matters only in
 *  that a rebase can leave a stale `MERGE_HEAD` from an earlier conflict — git
 *  itself treats `rebase-merge`/`rebase-apply` as authoritative when present,
 *  so they are checked first. */
const OPERATION_MARKERS: readonly { file: string; op: RepoOperation }[] = [
  { file: 'rebase-merge', op: 'rebase' },
  { file: 'rebase-apply', op: 'rebase' },
  { file: 'BISECT_LOG', op: 'bisect' },
  { file: 'CHERRY_PICK_HEAD', op: 'cherry-pick' },
  { file: 'REVERT_HEAD', op: 'revert' },
  { file: 'MERGE_HEAD', op: 'merge' },
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectOperation(gitDir: string): Promise<RepoOperation> {
  for (const marker of OPERATION_MARKERS) {
    if (await exists(join(gitDir, marker.file))) return marker.op;
  }
  return 'none';
}

async function revParseString(
  repo: string,
  query: argv.RevParseQuery
): Promise<{ ok: true; value: string } | GitError> {
  const res = await run('git', argv.revParse(query), { cwd: repo });
  if (res.ok !== true) return res;
  return { ok: true, value: res.outcome.stdout.trim() };
}

export async function buildRepoSnapshot(
  repo: string,
  relPath: string
): Promise<{ ok: true; snapshot: RepoSnapshot } | GitError> {
  const gitDirRes = await revParseString(repo, 'git-dir');
  if (gitDirRes.ok !== true) return gitDirRes;
  const gitDir = gitDirRes.value;

  const isBareRes = await revParseString(repo, 'is-bare-repository');
  if (isBareRes.ok !== true) return isBareRes;
  const isBare = isBareRes.value === 'true';

  const statusRes = await run('git', argv.status(), { cwd: repo });
  if (statusRes.ok !== true) return statusRes;
  const parsed = parseStatus(statusRes.outcome.stdout);
  const counts = countChanges(parsed.entries);

  const worktreeRes = await run('git', argv.worktreeList(), { cwd: repo });
  if (worktreeRes.ok !== true) return worktreeRes;
  const worktrees = parseWorktreeList(worktreeRes.outcome.stdout);

  let lastCommit: RepoSnapshot['lastCommit'] = null;
  if (parsed.headSha !== null) {
    const logRes = await run('git', argv.logCommit({ sha: parsed.headSha }), { cwd: repo });
    if (logRes.ok !== true) return logRes;
    const commits = parseLog(logRes.outcome.stdout);
    lastCommit = commits[0] ?? null;
  }

  const scan = await scanForRepos(repo);
  const nested = await describeNested(
    repo,
    scan.repos.filter((r) => r !== repo)
  );

  const operation = await detectOperation(gitDir);

  const snapshot: RepoSnapshot = {
    repo,
    name: repo.split(/[\\/]/).filter(Boolean).pop() ?? repo,
    relPath,
    gitDir,
    isBare,
    headSha: parsed.headSha,
    branch: parsed.branch,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    staged: counts.staged,
    unstaged: counts.unstaged,
    untracked: counts.untracked,
    conflicted: counts.conflicted,
    stashCount: parsed.stashCount,
    operation,
    lastCommit,
    worktrees,
    nested,
    capturedAt: Date.now(),
    stale: false,
  };
  return { ok: true, snapshot };
}
