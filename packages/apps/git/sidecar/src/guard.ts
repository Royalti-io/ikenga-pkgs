/**
 * com.ikenga.git · sidecar — the cross-repo staging guard (G-11).
 *
 * The workspace rule in `ikenga/CLAUDE.md` §Cross-repo conventions —
 *
 *   > Don't stage child-folder paths from the root repo, and don't stage root
 *   > files from inside a child repo.
 *
 * — is promoted here from tribal knowledge to a hard refusal. It is a named
 * Phase-1 feature, not a nicety: this workspace is a meta-repo with two dozen
 * independent nested clones, and `git add` in the parent will not tell you off
 * for naming a child's file. The child is gitignored from the parent, so the
 * parent does not even list it as untracked — the stage just quietly does
 * nothing useful, and the user is left with a commit box that looks armed and
 * is empty.
 *
 * ── Ownership by upward walk, not by scanning ───────────────────────────────
 *
 * The obvious implementation is `discover.scanForRepos(repo)` to enumerate
 * nested repos, then `discover.assertPathsOwnedBy(repo, paths, found)`. That is
 * the right shape when a caller ALREADY has the repo list — the rollup does,
 * and uses it — but it is the wrong shape here: it walks the entire tree to
 * answer a question about four paths. Measured on this workspace's root
 * meta-repo, that walk cost **1.5 s per stage click**, and it is bounded by
 * `MAX_SCAN_DEPTH` (4), so a repo nested five levels down would be MISSED —
 * the guard would silently pass the exact case it exists to catch.
 *
 * Walking UPWARD from each path instead is both faster and stricter: a handful
 * of `stat` calls, no depth ceiling, and the first `.git` encountered on the
 * way up is by construction the deepest repo containing the path, which is the
 * only correct answer. (`…/ikenga/shell/src/main.rs` is inside both `ikenga`
 * and `ikenga/shell`; answering `ikenga` is the bug.)
 *
 * `.git` is tested for EXISTENCE, not for being a directory: a linked worktree
 * and a submodule both use a `.git` FILE containing `gitdir: …`, and worktrees
 * are exactly what this pkg exists to make visible.
 */

import { dirname, resolve } from 'node:path';
import { crossRepoPath, isInside, type GitError } from '../../core/src/index.js';
import { exists } from './util.js';

/** Stat ceiling per path. A repo-relative pathspec nested deeper than this is
 *  not a thing a UI produces; the bound exists so a pathological input cannot
 *  turn one click into an unbounded walk. */
const MAX_WALK_DEPTH = 64;

/**
 * The deepest repository containing `absPath`, at or below `repo` — or `null`
 * when `repo` itself owns it.
 *
 * The walk starts at `absPath` rather than its parent so that naming a nested
 * repo's own directory (`paths: ['shell']`) is caught: that path IS the repo,
 * and staging it from the parent would record a gitlink, which is the
 * submodule-shaped accident D2 explicitly keeps out of v1.
 */
async function deepestRepoUnder(repo: string, absPath: string): Promise<string | null> {
  let dir = absPath;
  for (let i = 0; i < MAX_WALK_DEPTH; i += 1) {
    if (dir === repo || !isInside(repo, dir)) return null;
    if (await exists(resolve(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root; cannot happen inside `repo`
    dir = parent;
  }
  return null;
}

/**
 * Refuse a path list that does not belong to `repo`.
 *
 * Returns `null` when every path is owned by the target. On refusal the error
 * carries `path` and `ownerRepo`, which is what lets the Changes view offer
 * "stage it in `shell` instead" as a jump rather than a dead end (D-01 renders
 * this as an inspector card).
 *
 * Note the containment check is not redundant with `PathspecSchema`'s `..`
 * rejection: that is a string test on the pathspec, this is a containment test
 * on the resolved path. Both are lexical, so a path that leaves the repo
 * through a SYMLINKED directory is not caught by either — acceptable in v1
 * because git does not traverse symlinked directories for a pathspec (it
 * records the link itself as a blob), so such a path cannot reach outside the
 * repo's own index.
 *
 * An empty path list short-circuits: `commit.create` with no paths means
 * "commit what is already staged", and the index it commits is the target
 * repo's own — there is no boundary to cross.
 */
export async function assertPathsOwned(
  repo: string,
  paths: readonly string[]
): Promise<GitError | null> {
  if (paths.length === 0) return null;
  const target = resolve(repo);

  for (const rel of paths) {
    const abs = resolve(target, rel);
    if (!isInside(target, abs)) {
      return crossRepoPath(rel, target, null);
    }
    const owner = await deepestRepoUnder(target, abs);
    if (owner !== null) {
      return crossRepoPath(rel, target, owner);
    }
  }

  return null;
}
