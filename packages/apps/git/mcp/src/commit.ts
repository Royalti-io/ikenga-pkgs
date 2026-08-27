/**
 * com.ikenga.git · MCP — `git_commit`, the ONE mutating tool (G-MCP).
 *
 * "Stages nothing implicitly: it commits only the explicit path list, which is
 * what makes it safe enough to be the ONE mutating MCP tool" (01-plan.md
 * §MCP threat model). That promise is kept by an ASSERTION, not by a pathspec
 * (rpc.ts DELTA 7): the commit itself is `git commit -F -`, which records the
 * INDEX, and `assertStagedSetMatches` (git-core) refuses with
 * `staged-set-mismatch` — nothing committed — unless the repo's staged set is
 * exactly `paths`. The pathspec form this used to emit commits the WORKING
 * TREE of the named paths, so an `MM` file committed its unreviewed edit; that
 * failure mode is worse from here than from the UI, because the caller is an
 * agent that never looked at the file.
 *
 * The assertion lives in git-core precisely so this tool and the UI's
 * `commit.create` are provably the same operation. This module adds only the
 * MCP-specific non-empty-paths rule (rpc.ts Q3 — `paths: []` means "commit
 * what's staged" from the UI but is forbidden from the MCP, so `git_commit`
 * ALWAYS asserts) and the post-commit reads that answer verification 4 (real
 * identity, real signature) without the caller opening a terminal.
 */

import * as argv from '../../core/src/argv.js';
import { run } from '../../core/src/exec.js';
import { unsafeArgument } from '../../core/src/errors.js';
import { assertStagedSetMatches } from '../../core/src/staged.js';
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

  // THE EXPLICIT-PATH ASSERTION (G-04). `paths` is a claim about the index,
  // not a pathspec — see the header. A mismatch returns before anything is
  // written, so an agent that mis-stated what it staged gets a refusal it can
  // act on rather than a commit nobody reviewed.
  const mismatch = await assertStagedSetMatches(opts.repo, opts.paths);
  if (mismatch) return mismatch;

  const built = argv.commit({ message: opts.message });
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
