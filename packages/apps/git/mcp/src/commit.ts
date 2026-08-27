/**
 * com.ikenga.git · MCP — `git_commit`, the ONE mutating tool (G-MCP).
 *
 * "Stages nothing implicitly: it commits exactly these paths (`git commit --
 * <paths>`), which is what makes it safe enough to be the ONE mutating MCP
 * tool." (01-plan.md §MCP threat model) `argv.commit` already enforces the
 * message-on-stdin / `--only` shape (`core/src/argv.ts`); this module adds
 * only the MCP-specific non-empty-paths rule (rpc.ts Q3 — `paths: []` means
 * "commit what's staged" from the UI but is forbidden from the MCP) and the
 * post-commit reads that answer verification 4 (real identity, real
 * signature) without the caller opening a terminal.
 */

import * as argv from '../../core/src/argv.js';
import { run } from '../../core/src/exec.js';
import { unsafeArgument } from '../../core/src/errors.js';
import { parseCommitDetail } from '../../core/src/parse/index.js';
import { buildRepoSnapshot } from './repo-snapshot.js';
import type { GitError, RepoSnapshot } from '../../core/src/rpc.js';

export interface CommitCreated {
  repo: string;
  sha: string;
  summary: string;
  signed: boolean | null;
  snapshot: RepoSnapshot;
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return line.trim();
  }
  return '';
}

export async function commitCreate(opts: {
  repo: string;
  relPath: string;
  paths: readonly string[];
  message: string;
}): Promise<{ ok: true; result: CommitCreated } | GitError> {
  // MCP-only rule (rpc.ts Q3): the UI's `commit.create` may take `paths: []`
  // ("commit what's staged"); the MCP tool's OWN schema requires non-empty,
  // because "commits nothing implicitly" is half of what makes this tool
  // MCP-safe and an empty list would silently commit whatever a concurrent
  // process happened to have staged.
  if (opts.paths.length === 0) {
    return unsafeArgument('paths', 'git_commit requires at least one explicit path');
  }

  const built = argv.commit({ paths: opts.paths, message: opts.message });
  const commitRes = await run('git', built, { cwd: opts.repo });
  if (commitRes.ok !== true) return commitRes;
  const summary = firstNonEmptyLine(commitRes.outcome.stdout) || firstNonEmptyLine(commitRes.outcome.stderr);

  const shaRes = await run('git', argv.revParseVerify('HEAD'), { cwd: opts.repo });
  if (shaRes.ok !== true) return shaRes;
  const sha = shaRes.outcome.stdout.trim();

  // Read the signature back rather than assuming — this pkg never configures
  // signing itself; if the user has `commit.gpgsign=true` the inherited-env
  // spawn signed on its own, and this is how `signed` proves it without the
  // caller opening a terminal (verification 4).
  let signed: boolean | null = null;
  const sigRes = await run('git', argv.logCommit({ sha, withSignature: true }), { cwd: opts.repo });
  if (sigRes.ok === true) {
    const detail = parseCommitDetail(sigRes.outcome.stdout, { withSignature: true });
    signed = detail ? detail.signature !== null : null;
  }
  // A failed signature read degrades to `signed: null` ("unchecked") rather
  // than failing the whole commit — the commit already happened.

  const snapshotRes = await buildRepoSnapshot(opts.repo, opts.relPath);
  if (snapshotRes.ok !== true) return snapshotRes;

  return {
    ok: true,
    result: { repo: opts.repo, sha, summary, signed, snapshot: snapshotRes.snapshot },
  };
}
