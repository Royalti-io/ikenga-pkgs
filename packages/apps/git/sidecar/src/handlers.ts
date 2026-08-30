/**
 * com.ikenga.git · sidecar — the RPC handler table (WP-04).
 *
 * One function per member of `RpcMethod`, typed `satisfies RpcHandlers`. That
 * `satisfies` is the whole registration story on this side: omit a method and
 * this file stops compiling; invent one and it stops compiling. The frozen
 * contract (`core/src/rpc.ts`, G-RPC) is the only place a method is declared.
 *
 * ── What this process is ────────────────────────────────────────────────────
 *
 * ONE-SHOT. `manifest.sidecars[]` entries are NOT supervised — the kernel's
 * `SidecarsRegistry` only resolves bin paths, and `host.pkgSidecarCall` →
 * `pkg_sidecar_call` spawns a FRESH process per call, writes the request to
 * stdin, and reads stdout to exit (04-discussion.md Round 4, verified against
 * `shell/src-tauri/src/commands/pkg_sidecar.rs`). So there is no cache, no
 * watcher, no mutex, and no state of any kind between calls. Git on disk is
 * the owner (G-03); `--no-optional-locks` on every read is what makes reading
 * it every time affordable (verification 10).
 *
 * The `repo.changed` push signal is NOT emitted from here. It belongs to the
 * long-lived MCP (WP-05), which is the pkg's only supervised process and the
 * only one whose `notifications/message` frames the shell relays to the iframe.
 *
 * ── Invariants every handler holds ──────────────────────────────────────────
 *
 *   · Never throws. Every expected condition is a value from the frozen
 *     `GitErrorReason` union, because every one of them is a UI state.
 *   · Never constructs argv. Every `git` invocation goes through an `argv.ts`
 *     builder, which is the containment boundary (G-02).
 *   · Every mutating handler re-reads status afterwards and returns a fresh
 *     `RepoSnapshot`, rather than patching a model. That is the G-03
 *     mitigation for "two processes disagree about what is staged".
 *   · Every mutating handler goes through `withIndexLockRetry` (G-13).
 */

import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import {
  argv,
  assertStagedSetMatches,
  DEFAULT_DIFF_MAX_BYTES,
  GH_AUTH_STATUS_ARGV,
  GH_VERSION_ARGV,
  NETWORK_TIMEOUT_MS,
  exec,
  firstLine,
  gitError,
  mergeNumstat,
  parseBranchList,
  parseCommitDetail,
  parseLeftRightCount,
  parseLog,
  parseNumstat,
  parseStatus,
  parseWorktreeList,
  partitionChanges,
  resolveProjectRoot,
  run,
  runTolerant,
  toAheadBehind,
  toBranchInfo,
  type BranchInfo,
  type FileChange,
  type GhProbe,
  type GitError,
  type RepoSnapshot,
  type RpcHandlers,
} from '../../core/src/index.js';
import { ghPrList, ghPrCheckout, ghPrCreate } from '../../core/src/argv-gh.js';
import { assertPathsOwned } from './guard.js';
import { withIndexLockRetry } from './lock.js';
import {
  GIT_VERSION_ARGV,
  buildRollup,
  buildSnapshot,
  probeVersion,
  resolveRepo,
} from './repo.js';
import { mapLimit, now } from './util.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `repo`, then run `fn` against the verified toplevel.
 *
 * Every method that takes a `repo` starts here, so "is this actually a
 * repository, and is it the toplevel" is answered in exactly one place and
 * cannot be forgotten by a handler.
 */
async function inRepo<T extends { ok: true }>(
  repo: string,
  fn: (repo: string) => Promise<T | GitError>
): Promise<T | GitError> {
  const resolved = await resolveRepo(repo);
  if (resolved.ok !== true) return resolved;
  return fn(resolved.repo);
}

/**
 * Dirty for the purposes of the G-12 confirm tier.
 *
 * Untracked files are excluded on purpose: `git checkout <branch>` carries
 * untracked files across a switch untouched, so prompting about them would
 * train the user to click through a confirmation that never protected
 * anything — which is how a confirmation stops working on the day it matters.
 */
function isDirty(snapshot: RepoSnapshot): boolean {
  return snapshot.staged + snapshot.unstaged + snapshot.conflicted > 0;
}

/** Count `+`/`-` lines in a unified patch, ignoring the `+++`/`---` headers. */
function countPatchLines(patch: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }
  return { added, deleted };
}

/**
 * Cut a patch to `maxBytes` on a LINE boundary.
 *
 * `FileDiff.truncated` promises the UI that a cut patch still parses — every
 * diff renderer under consideration for D9 ingests unified text and will choke
 * on half a line. Cutting at the last newline costs at most one line and keeps
 * that promise.
 */
function truncatePatch(patch: string, maxBytes: number): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(patch, 'utf8') <= maxBytes) return { patch, truncated: false };
  const cut = Buffer.from(patch, 'utf8').subarray(0, maxBytes).toString('utf8');
  const lastNewline = cut.lastIndexOf('\n');
  return { patch: lastNewline > 0 ? cut.slice(0, lastNewline + 1) : cut, truncated: true };
}

/** Package version, read from the manifest that ships beside the bundle. */
async function pkgVersion(): Promise<string> {
  // `../../manifest.json` resolves correctly from BOTH `sidecar/src/` (tsx,
  // dev) and `sidecar/dist/` (bundled, installed) — the two directories sit at
  // the same depth under the package root.
  try {
    const raw = await readFile(new URL('../../manifest.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string') return parsed.version;
  } catch {
    // fall through
  }
  return '0.0.0-unknown';
}

/**
 * `gh auth status`, in NON-json mode.
 *
 * `--json` always exits 0 and is therefore useless as a health check
 * (02-research-external.md [35]); the plain form exits 1 if any host has an
 * auth problem. `gh` missing or logged out must NEVER park the pkg (D3) — it
 * darkens Phase 3 and nothing else, so every failure here is reported as data.
 */
async function probeGh(cwd: string): Promise<GhProbe> {
  const version = await probeVersion('gh', GH_VERSION_ARGV, cwd);
  if (version === null) {
    return { present: false, authenticated: false, hosts: [], version: null };
  }

  const res = await exec('gh', GH_AUTH_STATUS_ARGV, { cwd, timeoutMs: 10_000 });
  if (res.ok !== true) {
    return { present: true, authenticated: false, hosts: [], version };
  }

  // gh has moved this text between stdout and stderr across versions; read both.
  const text = `${res.outcome.stdout}\n${res.outcome.stderr}`;
  const hosts = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const loggedIn = /^(?:[✓✗x]\s+)?Logged in to (\S+)/i.exec(line);
    if (loggedIn) {
      hosts.add(loggedIn[1] as string);
      continue;
    }
    // Newer `gh` prints a bare host as a section header at column 0.
    if (/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)+$/.test(raw)) {
      hosts.add(raw.trim());
    }
  }

  return {
    present: true,
    authenticated: res.outcome.code === 0,
    hosts: [...hosts],
    version,
  };
}

function platformName(): 'linux' | 'darwin' | 'win32' | 'other' {
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win32';
  return 'other';
}

/**
 * Which remote to fetch from.
 *
 * Derived from the upstream short-ref (`origin/main` → `origin`) rather than
 * from `git config branch.<name>.remote`: `config` is not on the git-core
 * subcommand allowlist, and widening the containment boundary for one string
 * lookup is not a trade worth making (`rpc.ts` §REGISTRATION CHECKLIST item 4).
 * No upstream falls back to `origin`, which is what a user means by "fetch"
 * essentially always.
 */
function remoteFromUpstream(upstream: string | null): string {
  if (upstream === null) return 'origin';
  const slash = upstream.indexOf('/');
  return slash > 0 ? upstream.slice(0, slash) : 'origin';
}

/**
 * Refs a `git fetch` actually moved, from its progress output.
 *
 * git reports each update on stderr as `<range>  <src> -> <dst>`; the
 * right-hand side is the remote-tracking ref that changed. Nothing moved means
 * no such lines, which is exactly "already up to date" — reporting it as an
 * empty array rather than a sentence keeps the UI's badge logic on data.
 */
function parseFetchUpdates(stderr: string): string[] {
  const out: string[] = [];
  for (const line of stderr.split('\n')) {
    const m = /->\s+(\S+)\s*$/.exec(line.replace(/\s+\(.*\)\s*$/, ''));
    if (m && m[1] !== undefined) out.push(m[1]);
  }
  return [...new Set(out)];
}

/**
 * `BranchInfo.lastCommit` needs a full `CommitSummary` (parents, co-authors),
 * which `for-each-ref` cannot emit unambiguously — so it is one `log -1` per
 * branch. Bounded, because a repo with 400 remote branches would otherwise
 * turn `branch.list` into 400 spawns.
 *
 * Above the cap every branch reports `lastCommit: null` rather than some
 * branches resolving and others not: a list where the first 100 rows have a
 * commit and the rest are blank reads as a bug, whereas a uniformly blank
 * column reads as "not loaded" and the UI can say so.
 */
const BRANCH_LAST_COMMIT_MAX = 100;
const BRANCH_LAST_COMMIT_CONCURRENCY = 8;

// ─────────────────────────────────────────────────────────────────────────────
// The handlers
// ─────────────────────────────────────────────────────────────────────────────

export const handlers = {
  // ── system ────────────────────────────────────────────────────────────────

  'system.probe': async () => {
    // Probe from a directory that is guaranteed to exist and to not be a repo:
    // spawning with a dead cwd raises ENOENT, which `exec` would report as
    // "git was not found on PATH".
    const cwd = tmpdir();
    const [version, gitVersion, gh] = await Promise.all([
      pkgVersion(),
      probeVersion('git', GIT_VERSION_ARGV, cwd),
      probeGh(cwd),
    ]);

    return {
      ok: true as const,
      version,
      gitVersion,
      gh,
      platform: platformName(),
      // Always null from this process. The `@parcel/watcher` backend belongs
      // to the long-lived MCP (WP-05) — a one-shot process that exits after a
      // single request cannot watch anything, and claiming a backend it does
      // not run would be a lie the UI acts on.
      watcherBackend: null,
    };
  },

  // ── project / repo ────────────────────────────────────────────────────────

  'project.scan': async (args) => {
    // Resolve PER CALL from the host context passed through in `args.root`,
    // never from the spawn-time `IKENGA_PROJECT_ROOT` — that goes stale on a
    // project switch (`pkg_mcp.rs:206-212`). The three input cases map 1:1 onto
    // the G-05 states: absent → `no-project`, null → `no-project-root`,
    // unreadable → `unreadable`.
    const root = await resolveProjectRoot(args.root);
    if (root.ok !== true) return root;

    const rollup = await buildRollup({ root: root.root });
    if (rollup.ok !== true) return rollup;

    return {
      ok: true as const,
      project: {
        root: root.root,
        rootIsRepo: rollup.rollup.rootIsRepo,
        repos: rollup.rollup.repos,
        truncated: rollup.rollup.truncated,
        capturedAt: now(),
      },
    };
  },

  'repo.snapshot': async (args) =>
    inRepo(args.repo, async (repo) => {
      // `maxAgeMs` is accepted and ignored: there is no cache to serve from.
      // See `repo.ts` module header.
      const built = await buildSnapshot(repo);
      if (built.ok !== true) return built;
      return { ok: true as const, snapshot: built.snapshot };
    }),

  'repo.aheadBehind': async (args) =>
    inRepo(args.repo, async (repo) => {
      const head = args.head ?? 'HEAD';

      const counted = await run('git', argv.revListLeftRightCount({ base: args.base, head }), {
        cwd: repo,
      });
      if (counted.ok !== true) return counted;

      const counts = parseLeftRightCount(counted.outcome.stdout);
      if (counts === null) {
        return gitError(
          'git-failed',
          `could not read commit counts between ${args.base} and ${head}`,
          { stderr: counted.outcome.stderr }
        );
      }

      // Tolerant: `merge-base` exits 1 with no output for unrelated histories,
      // which is unusual but legal and must read as "unrelated", not as a
      // failed command.
      const base = await runTolerant('git', argv.mergeBase({ base: args.base, head }), {
        cwd: repo,
      });
      const mergeBase =
        base.ok === true && base.outcome.code === 0 ? base.outcome.stdout.trim() || null : null;

      return { ok: true as const, counts: toAheadBehind(args.base, head, counts, mergeBase) };
    }),

  'repo.fetch': async (args) =>
    inRepo(args.repo, async (repo) => {
      let remote = args.remote;
      if (remote === undefined) {
        const status = await run('git', argv.status({}), { cwd: repo });
        if (status.ok !== true) return status;
        remote = remoteFromUpstream(parseStatus(status.outcome.stdout).upstream);
      }

      const fetched = await run('git', argv.fetch({ remote, prune: args.prune }), {
        cwd: repo,
        timeoutMs: NETWORK_TIMEOUT_MS,
      });
      if (fetched.ok !== true) return fetched;

      const built = await buildSnapshot(repo);
      if (built.ok !== true) return built;

      return {
        ok: true as const,
        remote,
        updated: parseFetchUpdates(fetched.outcome.stderr),
        snapshot: built.snapshot,
      };
    }),

  // ── changes ───────────────────────────────────────────────────────────────

  'changes.list': async (args) =>
    inRepo(args.repo, async (repo) => {
      const listed = await run('git', argv.status({ includeIgnored: args.includeIgnored }), {
        cwd: repo,
      });
      if (listed.ok !== true) return listed;

      // `ChangesListResult` has no ignored bucket, so `!` entries are parsed
      // and then dropped by `partitionChanges`. The flag is honoured at the
      // git invocation (it changes what git walks) but is currently
      // observationally inert — noted rather than silently swallowed.
      const parsed = parseStatus(listed.outcome.stdout);
      let { staged, unstaged, untracked, conflicted } = partitionChanges(parsed.entries);

      if (args.withNumstat ?? true) {
        // The two sides need DIFFERENT numstat reads: `--cached` describes what
        // a commit would record, the plain form describes the working tree. A
        // file edited, staged, then edited again appears in both lists with
        // genuinely different counts, and merging one set into both would
        // report the wrong number on one of them.
        const [cachedRes, worktreeRes] = await Promise.all([
          run('git', argv.diffNumstat({ cached: true }), { cwd: repo }),
          run('git', argv.diffNumstat({ cached: false }), { cwd: repo }),
        ]);
        if (cachedRes.ok !== true) return cachedRes;
        if (worktreeRes.ok !== true) return worktreeRes;

        const cached = parseNumstat(cachedRes.outcome.stdout);
        const worktree = parseNumstat(worktreeRes.outcome.stdout);
        staged = mergeNumstat(staged, cached);
        unstaged = mergeNumstat(unstaged, worktree);
        conflicted = mergeNumstat(conflicted, worktree);
        // Untracked files have no numstat row at all — they are not in the
        // index — so they keep `added`/`deleted` null rather than a fabricated
        // 0/0 next to a brand-new 400-line file.
      }

      return {
        ok: true as const,
        repo,
        staged,
        unstaged,
        untracked,
        conflicted,
        capturedAt: now(),
      };
    }),

  'changes.diff': async (args) =>
    inRepo(args.repo, async (repo) => {
      // `sha` is required iff `side === 'commit'`. Zod cannot express that
      // dependency inside the frozen arg schema, so the handler enforces it —
      // and the mismatched pair is `invalid-args`, not a git failure.
      if (args.side === 'commit' && args.sha === undefined) {
        return gitError('invalid-args', 'sha is required when side is "commit"', { path: 'sha' });
      }
      if (args.side !== 'commit' && args.sha !== undefined) {
        return gitError('invalid-args', `sha is only valid when side is "commit"`, { path: 'sha' });
      }

      const maxBytes = args.maxBytes ?? DEFAULT_DIFF_MAX_BYTES;
      const built =
        args.side === 'commit'
          ? argv.commitPatch({
              sha: args.sha as string,
              path: args.path,
              contextLines: args.contextLines,
            })
          : argv.diffPatch({
              side: args.side,
              path: args.path,
              contextLines: args.contextLines,
            });

      const res = await run('git', built, {
        cwd: repo,
        // One extra byte of headroom so `truncated` is decided by measuring the
        // patch, not by whether the capture buffer happened to fill exactly.
        maxBuffer: maxBytes + 1,
      });
      if (res.ok !== true) return res;

      const raw = res.outcome.stdout;
      const binary = /^Binary files .* differ$/m.test(raw) || /^GIT binary patch$/m.test(raw);
      const { patch, truncated } = truncatePatch(raw, maxBytes);
      const rename = /^rename from (.+)$/m.exec(raw);
      const counts = binary ? null : countPatchLines(patch);

      return {
        ok: true as const,
        diff: {
          repo,
          path: args.path,
          origPath: rename?.[1] ?? null,
          side: args.side,
          patch,
          binary,
          isNew: /^new file mode /m.test(raw),
          isDeleted: /^deleted file mode /m.test(raw),
          added: counts?.added ?? null,
          deleted: counts?.deleted ?? null,
          truncated,
        },
      };
    }),

  'changes.stage': async (args) =>
    inRepo(args.repo, async (repo) => {
      const guard = await assertPathsOwned(repo, args.paths);
      if (guard) return guard;

      const staged = await withIndexLockRetry(() =>
        run('git', argv.add(args.paths), { cwd: repo })
      );
      if (staged.ok !== true) return staged;

      const built = await buildSnapshot(repo);
      if (built.ok !== true) return built;

      // `changed` is the path list the operation was APPLIED to. Reporting
      // only paths whose index entry actually moved would cost a status read
      // before and after every stage, and the UI re-renders from `snapshot`
      // regardless — the field's job is to let the caller match a response to
      // the request it made.
      return { ok: true as const, repo, changed: [...args.paths], snapshot: built.snapshot };
    }),

  'changes.unstage': async (args) =>
    inRepo(args.repo, async (repo) => {
      const guard = await assertPathsOwned(repo, args.paths);
      if (guard) return guard;

      // MIXED reset, scoped to paths: with a pathspec `reset` only rewrites
      // index entries and the working tree is untouched. `--hard` is not
      // merely omitted — git refuses it in this form, and `assertArgvSafe`
      // forbids the flag outright.
      const unstaged = await withIndexLockRetry(() =>
        run('git', argv.resetPaths(args.paths), { cwd: repo })
      );
      if (unstaged.ok !== true) return unstaged;

      const built = await buildSnapshot(repo);
      if (built.ok !== true) return built;

      return { ok: true as const, repo, changed: [...args.paths], snapshot: built.snapshot };
    }),

  // ── commit ────────────────────────────────────────────────────────────────

  'commit.create': async (args) =>
    inRepo(args.repo, async (repo) => {
      if (args.noVerify === true) {
        // The field exists so a future Phase-4 auto-commit mode does not
        // re-freeze G-RPC. It is refused in v1, and `assertArgvSafe` forbids
        // the flag independently — belt and braces, because a hook the user
        // installed is a hook the user meant.
        return gitError('invalid-args', 'noVerify is not available in v1', { path: 'noVerify' });
      }

      const guard = await assertPathsOwned(repo, args.paths);
      if (guard) return guard;

      const before = await buildSnapshot(repo);
      if (before.ok !== true) return before;
      if (before.snapshot.conflicted > 0) {
        return gitError('dirty-tree', 'resolve the conflicted paths before committing');
      }
      if (before.snapshot.operation !== 'none') {
        return gitError(
          'operation-in-progress',
          `a ${before.snapshot.operation} is in progress — finish or abort it first`
        );
      }

      // THE EXPLICIT-PATH ASSERTION (G-04, rpc.ts DELTA 7). `git commit`
      // records the INDEX; `args.paths` is the caller's claim about what the
      // index holds, and a claim that is wrong means the user is about to
      // commit something they did not review. Refuse, do not narrow: the
      // narrowing form (`--only -- <paths>`) commits the WORKING TREE of those
      // paths, which is exactly how an `MM` file used to commit its unstaged
      // edit. Read fresh here rather than reusing `before.snapshot` — the
      // snapshot is a moment old and another agent stages into these repos.
      if (args.paths.length > 0) {
        const mismatch = await assertStagedSetMatches(repo, args.paths);
        if (mismatch) return mismatch;
      }
      // `paths: []` is the UI-only "commit whatever is staged" affordance
      // (rpc.ts `CommitCreateArgs`); there is no claim to check. The MCP tool's
      // own schema forbids the empty list, so `git_commit` always asserts.

      // `-F -` keeps the message off argv entirely — a commit message is
      // multi-line free text that may begin with `-`.
      const committed = await withIndexLockRetry(() =>
        run('git', argv.commit({ message: args.message }), { cwd: repo })
      );
      if (committed.ok !== true) return committed;

      const head = await run('git', argv.revParseVerify('HEAD'), { cwd: repo });
      if (head.ok !== true) return head;
      const sha = head.outcome.stdout.trim();

      // Read the signature back off the commit git just wrote. This is
      // verification 4's evidence, produced by the pkg with zero signing code
      // of its own: if the user has `commit.gpgsign` / `gpg.format=ssh`
      // configured, the inherited-env spawn signed it and `%G?` says so.
      let signed: boolean | null = null;
      const detail = await runTolerant('git', argv.logCommit({ sha, withSignature: true }), {
        cwd: repo,
      });
      if (detail.ok === true && detail.outcome.code === 0) {
        // Bind before testing. `parse(…)?.signature !== null` reads naturally
        // and is wrong: a null parse yields `undefined !== null` — i.e. it
        // reports SIGNED for a commit it could not even read.
        const parsedDetail = parseCommitDetail(detail.outcome.stdout, { withSignature: true });
        if (parsedDetail !== null) signed = parsedDetail.signature !== null;
      }

      const after = await buildSnapshot(repo);
      if (after.ok !== true) return after;

      return {
        ok: true as const,
        repo,
        sha,
        summary: firstLine(committed.outcome.stdout),
        signed,
        snapshot: after.snapshot,
      };
    }),

  // ── history ───────────────────────────────────────────────────────────────

  'history.log': async (args) =>
    inRepo(args.repo, async (repo) => {
      const limit = args.limit ?? 500;
      const skip = args.skip ?? 0;

      // Tolerant: an unborn branch has no commits and `log` exits 128. An
      // empty history is a real state a fresh repo is in, not a failure.
      const res = await runTolerant(
        'git',
        argv.log({ ref: args.ref, limit, skip, path: args.path }),
        { cwd: repo }
      );
      if (res.ok !== true) return res;
      if (res.outcome.code !== 0) {
        if (/does not have any commits yet|unknown revision/i.test(res.outcome.stderr)) {
          return { ok: true as const, repo, commits: [], nextSkip: null };
        }
        return gitError('git-failed', firstLine(res.outcome.stderr), {
          exitCode: res.outcome.code,
          stderr: res.outcome.stderr,
        });
      }

      const commits = parseLog(res.outcome.stdout);
      // A full page implies there MAY be more; a short page is the end. `skip`
      // is an offset rather than an opaque cursor because the DAG is stable
      // under a ref for the life of a page view, and a changed ref means the
      // UI re-fetches from 0 anyway.
      return {
        ok: true as const,
        repo,
        commits,
        nextSkip: commits.length === limit ? skip + limit : null,
      };
    }),

  'history.commit': async (args) =>
    inRepo(args.repo, async (repo) => {
      const [detailRes, numstatRes] = await Promise.all([
        run('git', argv.logCommit({ sha: args.sha, withSignature: args.withSignature }), {
          cwd: repo,
        }),
        run('git', argv.logCommitNumstat({ sha: args.sha }), { cwd: repo }),
      ]);
      if (detailRes.ok !== true) return detailRes;
      if (numstatRes.ok !== true) return numstatRes;

      const commit = parseCommitDetail(detailRes.outcome.stdout, {
        withSignature: args.withSignature,
      });
      if (commit === null) {
        return gitError('git-failed', `no commit record for ${args.sha}`, { path: args.sha });
      }

      // A commit's files are reported on the INDEX side — they are what the
      // commit recorded. `--numstat` gives counts and rename pairs but not
      // add/delete/modify status, so every non-rename reads as `M`; a caller
      // that needs A/D specifically should diff the commit, not read this list.
      const files: FileChange[] = parseNumstat(numstatRes.outcome.stdout).map((n) => ({
        path: n.path,
        origPath: n.origPath,
        kind: n.origPath ? ('renamed' as const) : ('ordinary' as const),
        staged: n.origPath ? ('R' as const) : ('M' as const),
        unstaged: '.' as const,
        score: null,
        submodule: null,
        added: n.added,
        deleted: n.deleted,
        binary: n.binary,
      }));

      return { ok: true as const, commit: { ...commit, files } };
    }),

  // ── branches ──────────────────────────────────────────────────────────────

  'branch.list': async (args) =>
    inRepo(args.repo, async (repo) => {
      const res = await run('git', argv.branchList({ includeRemote: args.includeRemote }), {
        cwd: repo,
      });
      if (res.ok !== true) return res;

      const parsed = parseBranchList(res.outcome.stdout);
      const withCommits = parsed.length > 0 && parsed.length <= BRANCH_LAST_COMMIT_MAX;

      const lastCommits = withCommits
        ? await mapLimit(parsed, BRANCH_LAST_COMMIT_CONCURRENCY, async (b) => {
            if (b.headSha.length === 0) return null;
            const one = await runTolerant('git', argv.log({ ref: b.headSha, limit: 1 }), {
              cwd: repo,
            });
            if (one.ok !== true || one.outcome.code !== 0) return null;
            return parseLog(one.outcome.stdout)[0] ?? null;
          })
        : parsed.map(() => null);

      return {
        ok: true as const,
        repo,
        branches: parsed.map((b, i) => toBranchInfo(b, lastCommits[i] ?? null)),
      };
    }),

  'branch.create': async (args) =>
    inRepo(args.repo, async (repo) => {
      const before = await buildSnapshot(repo);
      if (before.ok !== true) return before;

      // Creating a ref is safe; it is the optional switch that inherits
      // `branch.checkout`'s confirm tier.
      if (args.checkout === true && isDirty(before.snapshot) && args.confirm !== true) {
        return gitError(
          'confirm-required',
          'the working tree has uncommitted changes — confirm to switch branches'
        );
      }

      const built =
        args.checkout === true
          ? argv.checkoutNewBranch({ name: args.name, startPoint: args.startPoint })
          : argv.branchCreate({ name: args.name, startPoint: args.startPoint });

      const created = await withIndexLockRetry(() => run('git', built, { cwd: repo }));
      if (created.ok !== true) return created;

      return finishBranchMutation(repo, args.name);
    }),

  'branch.checkout': async (args) =>
    inRepo(args.repo, async (repo) => {
      const before = await buildSnapshot(repo);
      if (before.ok !== true) return before;

      // The gate exists so the UI can explain BEFORE git errors — not so it
      // can override git. git's own "would be overwritten by checkout"
      // refusal still applies on top, and is classified as `dirty-tree`.
      if (isDirty(before.snapshot) && args.confirm !== true) {
        return gitError(
          'confirm-required',
          'the working tree has uncommitted changes — confirm to switch branches'
        );
      }

      const switched = await withIndexLockRetry(() =>
        run('git', argv.checkout({ name: args.name }), { cwd: repo })
      );
      if (switched.ok !== true) return switched;

      return finishBranchMutation(repo, args.name);
    }),

  // ── worktrees ─────────────────────────────────────────────────────────────

  'worktree.list': async (args) =>
    inRepo(args.repo, async (repo) => {
      const res = await run('git', argv.worktreeList(), { cwd: repo });
      if (res.ok !== true) return res;
      return { ok: true as const, repo, worktrees: parseWorktreeList(res.outcome.stdout) };
    }),

  'worktree.add': async (args) =>
    inRepo(args.repo, async (repo) => {
      const res = await withIndexLockRetry(() =>
        run('git', argv.worktreeAdd({ path: args.path, commitish: args.commitish, branch: args.branch }), { cwd: repo })
      );
      if (res.ok !== true) return res;
      return { ok: true as const, repo, path: args.path, branch: args.branch ?? null };
    }),

  'worktree.remove': async (args) =>
    inRepo(args.repo, async (repo) => {
      const res = await withIndexLockRetry(() =>
        run('git', argv.worktreeRemove({ path: args.path, force: args.force }), { cwd: repo })
      );
      if (res.ok !== true) return res;
      return { ok: true as const, repo, path: args.path };
    }),

  'repo.staleBase': async (args) =>
    inRepo(args.repo, async (repo) => {
      const base = args.base ?? 'main';
      const res = await run('git', argv.revListLeftRightCount({ base }), { cwd: repo });
      if (res.ok !== true || res.outcome.code !== 0) {
        if (base === 'main') {
          const fallback = await run('git', argv.revListLeftRightCount({ base: 'master' }), { cwd: repo });
          if (fallback.ok === true && fallback.outcome.code === 0) {
            const parts = fallback.outcome.stdout.trim().split(/\s+/);
            const behind = Number(parts[0]) || 0;
            const ahead = Number(parts[1]) || 0;
            return { ok: true as const, repo, base: 'master', ahead, behind, isStale: behind > 0 };
          }
        }
        return { ok: true as const, repo, base, ahead: 0, behind: 0, isStale: false };
      }
      const parts = res.outcome.stdout.trim().split(/\s+/);
      const behind = Number(parts[0]) || 0;
      const ahead = Number(parts[1]) || 0;
      return { ok: true as const, repo, base, ahead, behind, isStale: behind > 0 };
    }),

  // ── prs ───────────────────────────────────────────────────────────────────

  'pr.list': async (args) =>
    inRepo(args.repo, async (repo) => {
      const a = ghPrList({ state: args.state, limit: args.limit });
      if (a.ok !== true) return a;
      const res = await runTolerant('gh', a, { cwd: repo, timeoutMs: NETWORK_TIMEOUT_MS });
      if (res.ok !== true) return res;
      if (res.outcome.code !== 0) {
        const stderr = res.outcome.stderr.trim();
        const stdout = res.outcome.stdout.trim();
        const errText = stderr || (stdout !== '[]' ? stdout : '');
        return gitError('internal', `gh pr list failed: ${errText || `exit code ${res.outcome.code}`}`, {
          exitCode: res.outcome.code,
          stderr: errText,
        });
      }
      try {
        const raw = JSON.parse(res.outcome.stdout);
        const prs = Array.isArray(raw)
          ? raw.map((p: any) => ({
              number: Number(p.number) || 1,
              title: String(p.title ?? ''),
              author: {
                login: String(p.author?.login ?? 'ghost'),
                ...(p.author?.name ? { name: String(p.author.name) } : {}),
                ...(p.author?.avatarUrl ? { avatarUrl: String(p.author.avatarUrl) } : {}),
              },
              state: (p.state ? String(p.state).toUpperCase() : 'OPEN') as 'OPEN' | 'CLOSED' | 'MERGED',
              headRefName: String(p.headRefName ?? ''),
              baseRefName: String(p.baseRefName ?? 'main'),
              isDraft: Boolean(p.isDraft),
              url: String(p.url ?? ''),
              updatedAt: String(p.updatedAt ?? new Date().toISOString()),
              reviewDecision: p.reviewDecision && String(p.reviewDecision).trim() ? String(p.reviewDecision) : null,
              body: String(p.body ?? ''),
              comments: Array.isArray(p.comments)
                ? p.comments.map((c: any) => ({
                    id: c.id ? String(c.id) : undefined,
                    author: {
                      login: String(c.author?.login ?? 'ghost'),
                      ...(c.author?.avatarUrl ? { avatarUrl: String(c.author.avatarUrl) } : {}),
                    },
                    body: String(c.body ?? ''),
                    createdAt: String(c.createdAt ?? new Date().toISOString()),
                  }))
                : [],
              labels: Array.isArray(p.labels)
                ? p.labels.map((l: any) => ({
                    name: String(l.name ?? ''),
                    ...(l.color ? { color: String(l.color) } : {}),
                    ...(l.description ? { description: String(l.description) } : {}),
                  }))
                : [],
              additions: typeof p.additions === 'number' ? p.additions : 0,
              deletions: typeof p.deletions === 'number' ? p.deletions : 0,
              changedFiles: typeof p.changedFiles === 'number' ? p.changedFiles : 0,
            }))
          : [];
        return { ok: true as const, repo, prs };
      } catch (err) {
        return gitError('internal', `Failed to parse gh pr list output: ${String(err)}`);
      }
    }),

  'pr.checkout': async (args) =>
    inRepo(args.repo, async (repo) => {
      const a = ghPrCheckout({ number: args.number });
      if (a.ok !== true) return a;
      const res = await runTolerant('gh', a, { cwd: repo, timeoutMs: NETWORK_TIMEOUT_MS });
      if (res.ok !== true) return res;
      if (res.outcome.code !== 0) {
        const stderr = res.outcome.stderr.trim();
        const stdout = res.outcome.stdout.trim();
        const errText = stderr || (stdout !== '[]' ? stdout : '');
        return gitError('internal', `gh pr checkout failed: ${errText || `exit code ${res.outcome.code}`}`, {
          exitCode: res.outcome.code,
          stderr: errText,
        });
      }
      const branchRes = await run('git', argv.branchList({}), { cwd: repo });
      let branchName = `PR-${String(args.number)}`;
      if (branchRes.ok === true && branchRes.outcome.code === 0) {
        const parsed = parseBranchList(branchRes.outcome.stdout);
        const head = parsed.find((b) => b.isHead);
        if (head) branchName = head.name;
      }
      return { ok: true as const, repo, branch: branchName };
    }),

  'pr.create': async (args) =>
    inRepo(args.repo, async (repo) => {
      const a = ghPrCreate({ title: args.title, body: args.body, base: args.base, draft: args.draft });
      if (a.ok !== true) return a;
      const res = await runTolerant('gh', a, { cwd: repo, timeoutMs: NETWORK_TIMEOUT_MS });
      if (res.ok !== true) return res;
      if (res.outcome.code !== 0) {
        const stderr = res.outcome.stderr.trim();
        const stdout = res.outcome.stdout.trim();
        const errText = stderr || (stdout !== '[]' ? stdout : '');
        return gitError('internal', `gh pr create failed: ${errText || `exit code ${res.outcome.code}`}`, {
          exitCode: res.outcome.code,
          stderr: errText,
        });
      }
      const url = res.outcome.stdout.trim();
      const match = /\/pull\/(\d+)/.exec(url);
      const number = match ? parseInt(match[1]!, 10) : 1;
      return { ok: true as const, repo, url, number };
    }),
} satisfies RpcHandlers;

/**
 * Shared tail of `branch.create` / `branch.checkout`: re-read the branch and
 * the repo so the caller gets the post-mutation truth rather than an optimistic
 * echo of what it asked for.
 *
 * The fallback matters. `branch.checkout` accepts any `RefSchema` value, so
 * `name` can be a tag or a sha, which leaves HEAD detached and absent from
 * `branch --list`. Rather than fail a mutation that SUCCEEDED, synthesise the
 * `BranchInfo` from the fresh snapshot — the state git is actually in.
 */
async function finishBranchMutation(
  repo: string,
  name: string
): Promise<{ ok: true; repo: string; branch: BranchInfo; snapshot: RepoSnapshot } | GitError> {
  const snapshot = await buildSnapshot(repo);
  if (snapshot.ok !== true) return snapshot;

  const listed = await run('git', argv.branchList({}), { cwd: repo });
  if (listed.ok !== true) return listed;

  const parsed = parseBranchList(listed.outcome.stdout);
  const match = parsed.find((b) => b.name === name) ?? parsed.find((b) => b.isHead);

  const branch: BranchInfo = match
    ? toBranchInfo(match, snapshot.snapshot.lastCommit)
    : {
        name: snapshot.snapshot.branch ?? name,
        fullRef: snapshot.snapshot.branch ? `refs/heads/${snapshot.snapshot.branch}` : '',
        isHead: true,
        isRemote: false,
        upstream: snapshot.snapshot.upstream,
        ahead: snapshot.snapshot.ahead,
        behind: snapshot.snapshot.behind,
        lastCommit: snapshot.snapshot.lastCommit,
        worktreePath: null,
      };

  return { ok: true, repo, branch, snapshot: snapshot.snapshot };
}
