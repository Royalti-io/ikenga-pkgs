/**
 * com.ikenga.git · sidecar — repo resolution and `RepoSnapshot` construction.
 *
 * Every method in the contract takes an explicit `repo` (01-plan.md
 * §Multi-repo model: "there is no ambient current repo anywhere in this
 * contract"). This module is where that string becomes a verified repository
 * toplevel, and where the snapshot every mutating result carries is built.
 *
 * **No cache.** The Round-4 re-scope removed it, and not merely for want of a
 * process to hold it: a one-shot sidecar spawned per call could only have
 * cached to disk, and a stale on-disk cache is exactly the failure G-03 names
 * as the worst one a git tool can have ("the UI and Chi disagreeing about what
 * is staged"). Git on disk is the cache; `--no-optional-locks` is what makes
 * reading it cheap enough to do every time. `RepoSnapshot.stale` is therefore
 * always `false` here, and `RepoSnapshotArgs.maxAgeMs` is accepted and ignored
 * — the contract keeps both so a future supervised reader can honour them
 * without re-freezing G-RPC.
 */

import { basename, join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  argv,
  countChanges,
  describeNested,
  exec,
  findToplevel,
  gitError,
  isInside,
  parseLog,
  parseStatus,
  parseWorktreeList,
  run,
  runTolerant,
  scanForRepos,
  type CommitSummary,
  type GitError,
  type NestedRepo,
  type RepoOperation,
  type RepoSnapshot,
} from '../../core/src/index.js';
import { exists, mapLimit, now, posixRelative, SCAN_CONCURRENCY } from './util.js';

// ─────────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify that `repo` is a repository TOPLEVEL, and canonicalise it.
 *
 * Two behaviours worth stating, because both are refusals rather than
 * conveniences:
 *
 * · **A subdirectory is not the repo.** `git rev-parse --show-toplevel` walks
 *   upward, so calling it on `<repo>/src` answers `<repo>`. Accepting that
 *   would let `changes.stage({repo: '<repo>/src', paths: […]})` silently
 *   retarget to the parent, and the cross-repo guard would agree with it —
 *   the guard compares against the toplevel git reports, and git would be
 *   reporting the retargeted repo consistently. So a non-toplevel is
 *   `not-a-repository`, carrying `ownerRepo` so the caller can retry correctly.
 *
 * · **A missing path is `unreadable`, not `git-missing`.** `exec` maps a spawn
 *   `ENOENT` to "git was not found on PATH" — but spawning with a `cwd` that
 *   does not exist raises the same `ENOENT`, and reporting "install git" when
 *   the real answer is "that directory is gone" would send someone a long way
 *   in the wrong direction. Stat first.
 */
export async function resolveRepo(repo: string): Promise<{ ok: true; repo: string } | GitError> {
  const want = resolve(repo);

  try {
    const st = await stat(want);
    if (!st.isDirectory()) {
      return gitError('unreadable', `${want} is not a directory`, { path: want });
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return gitError('unreadable', `cannot read ${want}: ${e.code ?? e.message}`, { path: want });
  }

  const top = await findToplevel(want);
  if (top.ok !== true) return top;
  if (top.repo !== want) {
    return gitError(
      'not-a-repository',
      `${want} is not a repository toplevel — it belongs to ${top.repo}`,
      { path: want, ownerRepo: top.repo }
    );
  }
  return { ok: true, repo: want };
}

// ─────────────────────────────────────────────────────────────────────────────
// In-progress operation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which sequenced operation, if any, is mid-flight.
 *
 * Read from `.git` state files rather than from a subcommand: there is no
 * porcelain that reports this, `status`'s human output says it only in prose,
 * and the files are the same ones git itself checks. For a linked worktree the
 * relevant git-dir is the per-worktree one (`<main>/.git/worktrees/<name>`),
 * which is precisely what `rev-parse --absolute-git-dir` returns from inside
 * it — so this works unchanged in a worktree.
 *
 * `rebase-apply` is checked with `rebase-merge` because `git am` and the
 * older rebase backend share it; reporting `rebase` for an interrupted `am` is
 * closer to true than reporting `none`, and both block a commit for the same
 * reason.
 */
export async function detectOperation(gitDir: string): Promise<RepoOperation> {
  if ((await exists(join(gitDir, 'rebase-merge'))) || (await exists(join(gitDir, 'rebase-apply')))) {
    return 'rebase';
  }
  if (await exists(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (await exists(join(gitDir, 'REVERT_HEAD'))) return 'revert';
  if (await exists(join(gitDir, 'MERGE_HEAD'))) return 'merge';
  if (await exists(join(gitDir, 'BISECT_LOG'))) return 'bisect';
  return 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapshotOptions {
  /**
   * Position within the project, for display ordering.
   *
   * `repo.snapshot` takes no project root — the contract deliberately gives
   * every method an explicit `repo` and nothing else — so a snapshot built for
   * that method reports `'.'`. Only `project.scan`, which knows the root,
   * supplies the real value.
   */
  relPath?: string;
  /** Nested repos, when the caller has already scanned (the rollup path). */
  nested?: NestedRepo[];
}

/**
 * Build one `RepoSnapshot`.
 *
 * Five reads, four of which are independent and therefore concurrent:
 * `status`, `rev-parse --absolute-git-dir`, `rev-parse --is-bare-repository`,
 * `worktree list`. `log -1` follows because it is TOLERANT of failure — an
 * unborn branch (`git init` with no commit yet) makes `git log` exit non-zero,
 * and that is a normal state, not an error to surface.
 *
 * Nested repos are scanned here only when the caller did not supply them. The
 * rollup path always supplies them, because it already has the full repo list
 * and re-walking the tree once per repo would be quadratic on this workspace.
 */
export async function buildSnapshot(
  repo: string,
  opts: SnapshotOptions = {}
): Promise<{ ok: true; snapshot: RepoSnapshot } | GitError> {
  const cwd = repo;

  const [statusRes, gitDirRes, bareRes, worktreeRes] = await Promise.all([
    run('git', argv.status({}), { cwd }),
    run('git', argv.revParse('git-dir'), { cwd }),
    run('git', argv.revParse('is-bare-repository'), { cwd }),
    run('git', argv.worktreeList(), { cwd }),
  ]);

  if (statusRes.ok !== true) return statusRes;
  if (gitDirRes.ok !== true) return gitDirRes;
  if (bareRes.ok !== true) return bareRes;
  if (worktreeRes.ok !== true) return worktreeRes;

  const status = parseStatus(statusRes.outcome.stdout);
  const gitDir = gitDirRes.outcome.stdout.trim();
  const isBare = bareRes.outcome.stdout.trim() === 'true';
  const worktrees = parseWorktreeList(worktreeRes.outcome.stdout);
  const counts = countChanges(status.entries);

  // Tolerant: an unborn branch has no HEAD commit and `log` exits 128.
  let lastCommit: CommitSummary | null = null;
  const logRes = await runTolerant('git', argv.log({ limit: 1 }), { cwd });
  if (logRes.ok === true && logRes.outcome.code === 0) {
    lastCommit = parseLog(logRes.outcome.stdout)[0] ?? null;
  }

  const nested = opts.nested ?? (await scanNestedOf(repo));

  return {
    ok: true,
    snapshot: {
      repo,
      name: basename(repo),
      relPath: opts.relPath ?? '.',
      gitDir,
      isBare,
      headSha: status.headSha,
      branch: status.branch,
      detached: status.detached,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      staged: counts.staged,
      unstaged: counts.unstaged,
      untracked: counts.untracked,
      conflicted: counts.conflicted,
      stashCount: status.stashCount,
      operation: await detectOperation(gitDir),
      lastCommit,
      worktrees,
      nested,
      capturedAt: now(),
      // Never served from a cache — there is no cache. See the module header.
      stale: false,
    },
  };
}

/** Nested repos strictly inside `repo`, described. */
export async function scanNestedOf(repo: string): Promise<NestedRepo[]> {
  const scan = await scanForRepos(repo);
  const inner = scan.repos.map((r) => resolve(r)).filter((r) => r !== repo && isInside(repo, r));
  return describeNested(repo, inner);
}

// ─────────────────────────────────────────────────────────────────────────────
// The project rollup
// ─────────────────────────────────────────────────────────────────────────────

export interface RollupInput {
  /** Already-resolved, existing project root. */
  root: string;
}

export interface RollupOutput {
  rootIsRepo: boolean;
  repos: RepoSnapshot[];
  truncated: boolean;
}

/**
 * Scan a project root and snapshot every repo in it (G-11, D2).
 *
 * The ordering rule is the contract's: the root repo first when the root is
 * itself a repo, then every nested repo by `relPath`. That ordering is what
 * the Changes-view tree indents against, so it is decided here rather than in
 * the UI.
 *
 * A nested repo whose snapshot FAILS is skipped with a stderr note rather than
 * failing the whole rollup: `ProjectRollup.repos` has no error slot, and one
 * corrupt clone in a twelve-repo workspace must not blank the view. A failure
 * on the ROOT repo is returned, because at that point there is nothing sensible
 * left to render.
 */
export async function buildRollup(
  input: RollupInput
): Promise<{ ok: true; rollup: RollupOutput } | GitError> {
  const root = input.root;
  const scan = await scanForRepos(root);
  const found = scan.repos.map((r) => resolve(r));
  const rootIsRepo = found.includes(root);

  // DELTA 3 (rpc.ts): not-a-repo + zero nested ⇒ `not-a-repository`;
  // not-a-repo + ≥1 nested ⇒ ok with `rootIsRepo: false`.
  if (!rootIsRepo && found.length === 0) {
    return gitError('not-a-repository', `${root} is not a git repository`, { path: root });
  }

  const ordered = [
    ...(rootIsRepo ? [root] : []),
    ...found
      .filter((r) => r !== root)
      .sort((a, b) => posixRelative(root, a).localeCompare(posixRelative(root, b))),
  ];

  // One walk, reused: every repo's `nested` is derived from the single scan
  // above rather than re-walking per repo.
  const nestedByRepo = new Map<string, NestedRepo[]>();
  await mapLimit(ordered, SCAN_CONCURRENCY, async (repo) => {
    const inner = found.filter((r) => r !== repo && isInside(repo, r));
    nestedByRepo.set(repo, inner.length === 0 ? [] : await describeNested(repo, inner));
  });

  const built = await mapLimit(ordered, SCAN_CONCURRENCY, (repo) =>
    buildSnapshot(repo, {
      relPath: repo === root ? '.' : posixRelative(root, repo),
      nested: nestedByRepo.get(repo) ?? [],
    })
  );

  const repos: RepoSnapshot[] = [];
  for (let i = 0; i < built.length; i += 1) {
    const res = built[i];
    if (res === undefined) continue;
    if (res.ok !== true) {
      const repo = ordered[i] as string;
      if (rootIsRepo && repo === root) return res;
      process.stderr.write(`[git-sidecar] skipping ${repo}: ${res.reason} — ${res.message}\n`);
      continue;
    }
    repos.push(res.snapshot);
  }

  return { ok: true, rollup: { rootIsRepo, repos, truncated: scan.truncated } };
}

// ─────────────────────────────────────────────────────────────────────────────
// gh / git presence, for `system.probe`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `git --version` / `gh --version` bypass the `argv.ts` builders deliberately.
 *
 * `--version` is not a subcommand, so `assertArgvSafe` would reject it — the
 * allowlist is a list of SUBCOMMANDS and widening it to admit a flag would
 * weaken exactly the check that makes it meaningful. These two argvs are
 * frozen literals with no interpolation of any kind, which is the same
 * reasoning under which git-core itself exports `GH_VERSION_ARGV` /
 * `GH_AUTH_STATUS_ARGV` as constants rather than builders.
 */
export const GIT_VERSION_ARGV: readonly string[] = ['--version'];

/** Probe a binary's `--version` from a directory that always exists. */
export async function probeVersion(
  bin: 'git' | 'gh',
  versionArgv: readonly string[],
  cwd: string
): Promise<string | null> {
  const res = await exec(bin, versionArgv, { cwd, timeoutMs: 5_000 });
  if (res.ok !== true || res.outcome.code !== 0) return null;
  const line = res.outcome.stdout.split('\n')[0];
  return line === undefined || line.trim().length === 0 ? null : line.trim();
}
