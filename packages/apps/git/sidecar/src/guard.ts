/**
 * com.ikenga.git · sidecar — the cross-repo staging guard (G-11).
 *
 * The workspace rule in `ikenga/CLAUDE.md` §Cross-repo conventions —
 *
 *   > Don't stage child-folder paths from the root repo, and don't stage root
 *   > files from inside a child repo.
 *
 * — is promoted here from tribal knowledge to a hard refusal. It is a named
 * Phase-1 feature, not a nicety: this workspace is a meta-repo with a dozen
 * independent nested clones, and `git add` in the parent will happily stage a
 * path that belongs to a child (the child is gitignored from the parent, so
 * the parent does not even show it as untracked — it just quietly does nothing
 * useful, or worse, records a gitlink).
 *
 * Two halves, both needed:
 *
 *   · **Escaping the target repo** — caught by containment. `PathspecSchema`
 *     already rejects `..` and absolute paths at the parse boundary, so this
 *     half mostly catches a symlinked path, and is cheap insurance either way.
 *
 *   · **Belonging to a nested repo** — caught by ownership. This is the half
 *     that matters, and it is why the guard needs to know which repos exist
 *     BELOW the target.
 *
 * `discover.ownerRepoOf` answers with the DEEPEST containing repo, which is
 * the whole point: `…/ikenga/shell/src/main.rs` is inside both `…/ikenga` and
 * `…/ikenga/shell`, and answering `ikenga` would be precisely the bug.
 */

import { resolve } from 'node:path';
import {
  assertPathsOwnedBy,
  isInside,
  scanForRepos,
  type GitError,
} from '../../core/src/index.js';

/**
 * The repos the guard measures against: the target plus every repo nested
 * inside it.
 *
 * Deliberately scoped DOWNWARD from the target rather than outward from the
 * project root. Two reasons:
 *
 *   1. Correctness is unaffected. A path that leaves the target upward is
 *      already refused by containment, so an ancestor repo could never be the
 *      right answer for a path the target might otherwise have staged.
 *   2. The guard must work for `repo.*` methods that are given a repo and no
 *      project root — which is every method in the contract. Requiring the
 *      root would mean either threading it through methods that do not have
 *      it, or resolving it out of band, and both reintroduce the ambient
 *      "current project" the contract exists to avoid.
 */
export async function knownReposUnder(repo: string): Promise<string[]> {
  const target = resolve(repo);
  const scan = await scanForRepos(target);
  const inner = scan.repos.map((r) => resolve(r)).filter((r) => r !== target && isInside(target, r));
  return [target, ...inner];
}

/**
 * Refuse a path list that does not belong to `repo`.
 *
 * Returns `null` when every path is owned by the target. On refusal the error
 * carries `path` and `ownerRepo`, which is what lets the Changes view offer
 * "stage it in `shell` instead" as a jump rather than a dead end (D-01 renders
 * this as an inspector card).
 *
 * The scan is skipped entirely for an empty path list — `commit.create` with
 * no paths means "commit what is already staged", which cannot cross a repo
 * boundary because the index it commits is the target repo's own.
 */
export async function assertPathsOwned(
  repo: string,
  paths: readonly string[]
): Promise<GitError | null> {
  if (paths.length === 0) return null;
  const known = await knownReposUnder(repo);
  return assertPathsOwnedBy(repo, paths, known);
}
