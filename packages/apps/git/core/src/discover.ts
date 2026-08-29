/**
 * com.ikenga.git · git-core — repo discovery (G-11, G-05).
 *
 * The UI unit is a **project containing N repos** (D2, locked R1). The
 * dogfood target is this very workspace: a root meta-repo plus ten-odd
 * independent nested clones, which are NOT submodules — `ikenga/` is
 * gitignored from the `royalti-co` monorepo and each child pushes to its own
 * `ikenga-hq/*` remote. Retrofitting nesting later would be a rewrite, so it
 * is here from Phase 1.
 *
 * Three responsibilities:
 *   1. **Root resolution** — map `hostContext.royaltiSuite.activeProject.root`
 *      onto the four G-05 no-root states. Every one is a named error, never a
 *      throw and never a failed git spawn.
 *   2. **Nested scan** — a bounded filesystem walk for `.git` entries, because
 *      a project root is user-chosen and could be `$HOME`.
 *   3. **Ownership** — which repo owns a given absolute path. This is the
 *      primitive behind the cross-repo staging guard: the root repo must not
 *      stage child-folder paths and a child must not stage root files
 *      (workspace `CLAUDE.md` §Cross-repo conventions, promoted to a hard
 *      refusal).
 */

import { readFile, stat } from 'node:fs/promises';
import { opendir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as argv from './argv.js';
import { crossRepoPath, gitError } from './errors.js';
import { exec, type SpawnOptions } from './exec.js';
import {
  MAX_REPOS,
  MAX_SCAN_DEPTH,
  SCAN_SKIP_DIRS,
  type GitError,
  type NestedRepo,
} from './rpc.js';

const NUL = '\u0000';

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Root resolution — the four G-05 states
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the project root passed through from the host context.
 *
 * The three INPUT cases map 1:1 onto G-05 (`rpc.ts` §ProjectScanArgs):
 *   · `undefined` — no active project, or the field is absent entirely on an
 *     older shell / before the handshake        → `no-project`
 *   · `null`      — the seed Default project, or a skill-only project, whose
 *     `root_path` is genuinely null             → `no-project-root`
 *   · a string    — scan it
 *
 * The fourth state (`unreadable`) is decided here too, by stat-ing the path.
 * "Not a repository" is NOT decided here: a root that is not itself a repo but
 * contains nested clones is a valid project (`ProjectRollup.rootIsRepo:false`,
 * `rpc.ts` DELTA 3), so only the scan can tell the difference.
 *
 * Resolve PER CALL. Never cache this and never read it from the spawn-time
 * `IKENGA_PROJECT_ROOT`: that goes stale the moment the user switches project
 * (`pkg_mcp.rs:206-212`).
 */
export async function resolveProjectRoot(
  root: string | null | undefined
): Promise<{ ok: true; root: string } | GitError> {
  if (root === undefined) {
    return gitError('no-project', 'no active project');
  }
  if (root === null) {
    return gitError('no-project-root', 'the active project has no root directory');
  }
  if (!isAbsolute(root)) {
    return gitError('unreadable', `project root is not an absolute path: ${root}`, { path: root });
  }

  try {
    const st = await stat(root);
    if (!st.isDirectory()) {
      return gitError('unreadable', `project root is not a directory: ${root}`, { path: root });
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return gitError('unreadable', `cannot read project root: ${e.code ?? e.message}`, {
      path: root,
    });
  }

  return { ok: true, root: resolve(root) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Toplevel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `git rev-parse --show-toplevel` from `dir`.
 *
 * Returns `not-a-repository` — the named G-05 state (c) — rather than a git
 * failure, because "this directory is not a repo" is an ordinary, expected
 * answer for a project root, not an error the user should see a stderr for.
 *
 * Note this walks UPWARD: called inside `repo/sub/dir` it returns `repo`. That
 * is what makes it the right primitive for "which repo owns this path", and
 * also why `scanForRepos` must not use it as a per-directory probe — every
 * directory inside a repo would answer yes.
 */
export async function findToplevel(
  dir: string,
  opts: Partial<SpawnOptions> = {}
): Promise<{ ok: true; repo: string } | GitError> {
  const built = argv.revParse('show-toplevel');
  if (built.ok !== true) return built;

  const res = await exec('git', built.argv, { ...opts, cwd: dir });
  if (res.ok !== true) return res;
  if (res.outcome.code !== 0) {
    if (/not a git repository/i.test(res.outcome.stderr)) {
      return gitError('not-a-repository', `${dir} is not inside a git repository`, { path: dir });
    }
    if (/(No such file or directory|cannot change to)/i.test(res.outcome.stderr)) {
      return gitError('unreadable', `cannot read ${dir}`, { path: dir });
    }
    return gitError('not-a-repository', `${dir} is not inside a git repository`, {
      path: dir,
      stderr: res.outcome.stderr,
    });
  }

  const top = res.outcome.stdout.trim();
  if (top.length === 0) {
    return gitError('not-a-repository', `${dir} is not inside a git repository`, { path: dir });
  }
  return { ok: true, repo: resolve(top) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The bounded nested scan
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanOptions {
  maxDepth?: number;
  maxRepos?: number;
  skipDirs?: readonly string[];
}

export interface ScanResult {
  /** Absolute directories containing a `.git` entry, shallowest first. */
  repos: string[];
  /** True when the walk hit `maxDepth` or `maxRepos` and stopped early. The UI
   *  says so rather than silently showing a partial workspace. */
  truncated: boolean;
}

/**
 * Walk `root` for directories containing a `.git` entry.
 *
 * Design notes that are not obvious:
 *
 * · **`.git` may be a FILE, not a directory.** A linked worktree and a
 *   submodule both use a `.git` file containing `gitdir: …`. Testing only for
 *   a directory misses every worktree — and worktrees are the thing this pkg
 *   exists to make visible.
 *
 * · **We descend INTO a repo we found.** The ikenga workspace is exactly this
 *   shape (meta-repo → children → `.worktrees/*`), so stopping at the first
 *   hit would find one repo and call it a day.
 *
 * · **Dot-directories are walked, `.git` is not.** Skipping all dotdirs would
 *   miss `.worktrees/`, which is where agent worktrees actually live here.
 *   Descending into `.git` would walk thousands of object directories.
 *
 * · **`SCAN_SKIP_DIRS`** (`node_modules`, `target`, `dist`, …) matters more
 *   than it looks: a pnpm store under `node_modules/.pnpm` can hold vendored
 *   git checkouts, and walking it can cost seconds.
 *
 * The walk is breadth-first so that `truncated` cuts the DEEPEST repos rather
 * than an arbitrary subtree — a partial view that keeps the top-level children
 * is far more useful than one that keeps a random branch of the tree.
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function scanForRepos(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const maxDepth = opts.maxDepth ?? MAX_SCAN_DEPTH;
  const maxRepos = opts.maxRepos ?? MAX_REPOS;
  const skip = new Set<string>(opts.skipDirs ?? SCAN_SKIP_DIRS);

  const repos: string[] = [];
  let truncated = false;

  let frontier: { dir: string; depth: number; insideRepo: boolean }[] = [
    { dir: resolve(root), depth: 0, insideRepo: false },
  ];

  while (frontier.length > 0) {
    const next: { dir: string; depth: number; insideRepo: boolean }[] = [];

    for (const { dir, depth, insideRepo } of frontier) {
      if (repos.length >= maxRepos) {
        truncated = true;
        return { repos, truncated };
      }

      let entries: { name: string; isDir: boolean }[];
      try {
        entries = [];
        const handle = await opendir(dir);
        for await (const d of handle) {
          entries.push({ name: d.name, isDir: d.isDirectory() });
        }
      } catch {
        // An unreadable subdirectory is skipped, not fatal: one bad-permission
        // directory must not blank the whole project view.
        continue;
      }

      const isRepo = entries.some((e) => e.name === '.git');
      if (isRepo) {
        repos.push(dir);
        if (repos.length >= maxRepos) {
          truncated = true;
          return { repos, truncated };
        }
      }

      const nowInsideRepo = insideRepo || isRepo;

      if (depth >= maxDepth) {
        // Only mark truncated if an unvisited subdirectory actually contains a .git entry
        for (const e of entries) {
          if (e.isDir && e.name !== '.git' && !skip.has(e.name)) {
            if (await pathExists(join(dir, e.name, '.git'))) {
              truncated = true;
              break;
            }
          }
        }
        continue;
      }

      for (const e of entries) {
        if (!e.isDir) continue;
        if (e.name === '.git' || skip.has(e.name)) continue;

        // When inside a repo, prune deep recursion into standard code/docs trees
        // (src, docs, tests, etc.) that are not nested Git repositories.
        if (nowInsideRepo) {
          const lower = e.name.toLowerCase();
          if (
            lower === 'src' ||
            lower === 'docs' ||
            lower === 'tests' ||
            lower === 'test' ||
            lower === 'config' ||
            lower === 'fixtures' ||
            lower === 'scripts' ||
            lower === 'artifacts' ||
            lower === 'plans' ||
            lower === 'tasks' ||
            lower === 'temp' ||
            lower === 'swagger'
          ) {
            // Quick check if this folder itself contains a .git file/dir
            const hasGit = await pathExists(join(dir, e.name, '.git'));
            if (hasGit) {
              next.push({ dir: join(dir, e.name), depth: depth + 1, insideRepo: true });
            }
            continue;
          }
        }

        next.push({ dir: join(dir, e.name), depth: depth + 1, insideRepo: nowInsideRepo });
      }
    }

    frontier = next;
  }

  return { repos, truncated };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · `.gitmodules` (read-only) and parent-ignore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submodule paths declared in a repo's `.gitmodules`.
 *
 * Read-only signal in v1: submodule OPERATIONS are out of scope (D2), but a
 * nested repo that is a declared submodule behaves differently from an
 * independent clone and the UI must be able to say which it is looking at.
 *
 * Deliberately a line parser, not `git config -f`: `config` is not on the
 * subcommand allowlist, and `.gitmodules` is a plain file in the working tree.
 */
export async function readGitmodulePaths(repo: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(repo, '.gitmodules'), 'utf8');
  } catch {
    return []; // absent is the common case, not an error
  }
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
    if (m) out.push(m[1] as string);
  }
  return out;
}

/**
 * Is `relPath` ignored by its parent repo?
 *
 * Answered with a pathspec-scoped `git status --ignored=matching`, which
 * reports an ignored path as a `!` entry. `git check-ignore` would be the
 * direct tool and is deliberately NOT used: it is not on git-core's subcommand
 * allowlist, and widening that allowlist is a plan change (`rpc.ts`
 * §REGISTRATION CHECKLIST item 4). One boolean does not justify moving the
 * containment boundary.
 *
 * This is what explains the workspace's own oddity in the UI — `ikenga/` is
 * gitignored from the `royalti-co` monorepo, so "why does the parent not see
 * this repo" has an answer on screen instead of in tribal memory.
 */
export async function isIgnoredByParent(
  parentRepo: string,
  relPath: string,
  opts: Partial<SpawnOptions> = {}
): Promise<boolean> {
  const built = argv.statusOfPath(relPath);
  if (built.ok !== true) return false;
  const res = await exec('git', built.argv, { ...opts, cwd: parentRepo });
  if (res.ok !== true || res.outcome.code !== 0) return false;
  return res.outcome.stdout.split(NUL).some((chunk) => chunk.startsWith('! '));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Ownership — the cross-repo staging guard's primitive
// ─────────────────────────────────────────────────────────────────────────────

/** True when `child` is `parent` or lives inside it. Boundary-aware: `/a/bc`
 *  is NOT inside `/a/b`, which a naive `startsWith` gets wrong. */
export function isInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  if (p === c) return true;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * The repo that owns `absPath`: the DEEPEST known repo containing it.
 *
 * Deepest, not first: in this workspace `/…/ikenga/shell/src/main.rs` is inside
 * both `/…/ikenga` and `/…/ikenga/shell`, and the answer that matters is
 * `shell`. Returning the outermost match is exactly the bug the cross-repo
 * guard exists to prevent — it would let the root meta-repo stage a child
 * repo's file.
 */
export function ownerRepoOf(absPath: string, repos: readonly string[]): string | null {
  let best: string | null = null;
  for (const repo of repos) {
    if (!isInside(repo, absPath)) continue;
    if (best === null || resolve(repo).length > resolve(best).length) best = resolve(repo);
  }
  return best;
}

/**
 * G-11 cross-repo staging guard.
 *
 * Refuses when a repo-relative pathspec, resolved against `repo`, is actually
 * owned by a different known repo — or escapes `repo` altogether. The error
 * carries `ownerRepo` so the UI can offer "stage it there" as a jump rather
 * than a dead end.
 *
 * Note the second check is not redundant with `PathspecSchema`'s `..`
 * rejection: a path can leave the repo through a SYMLINK without containing
 * `..`, and `..` rejection is a string test while this is a containment test.
 */
export function assertPathsOwnedBy(
  repo: string,
  paths: readonly string[],
  knownRepos: readonly string[]
): GitError | null {
  const target = resolve(repo);
  for (const rel of paths) {
    const abs = resolve(target, rel);
    if (!isInside(target, abs)) {
      return crossRepoPath(rel, target, ownerRepoOf(abs, knownRepos));
    }
    const owner = ownerRepoOf(abs, knownRepos);
    if (owner !== null && owner !== target) {
      return crossRepoPath(rel, target, owner);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · Describing nested repos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build `NestedRepo` records for every repo under `parentRepo`.
 *
 * `depth` counts directory levels below the parent toplevel — 1 for `shell/`,
 * 2 for `.worktrees/shell/` — and is what the UI indents by. `relPath` is
 * always POSIX-normalised for display, while `repo` stays a real absolute
 * platform path (D10: cross-platform from Phase 1).
 */
export async function describeNested(
  parentRepo: string,
  repoPaths: readonly string[],
  opts: Partial<SpawnOptions> = {}
): Promise<NestedRepo[]> {
  const parent = resolve(parentRepo);
  const submodulePaths = new Set(await readGitmodulePaths(parent));
  const out: NestedRepo[] = [];

  for (const repoPath of repoPaths) {
    const repo = resolve(repoPath);
    if (repo === parent || !isInside(parent, repo)) continue;

    const rel = relative(parent, repo);
    const relPosix = rel.split(sep).join('/');
    const segments = relPosix.split('/').filter((s) => s.length > 0);

    out.push({
      repo,
      relPath: relPosix,
      name: segments[segments.length - 1] ?? relPosix,
      depth: segments.length,
      isSubmodule: submodulePaths.has(relPosix),
      ignoredByParent: await isIgnoredByParent(parent, relPosix, opts),
    });
  }

  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}
