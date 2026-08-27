/**
 * com.ikenga.git · MCP — `repo` containment gate (G-04).
 *
 * "Every tool takes an explicit `repo`, resolved against the `projects`
 * table's known roots (via the iyke bridge) and refused outside them"
 * (01-plan.md §MCP threat model). This is the one function every tool
 * handler calls before touching git-core.
 *
 * Two things are checked, not one:
 *   1. `repo` (as sent by the caller) resolves to a git toplevel at all —
 *      `git-core.findToplevel` — using it as `cwd` directly rather than
 *      trusting the string, so a caller cannot claim to be a toplevel that
 *      does not exist.
 *   2. That REAL toplevel is inside (or equal to) a known project root.
 *      Checking the resolved toplevel rather than the raw input string is
 *      what stops a symlink or a relative-looking value from walking out of
 *      the known set between the check and the git-core call.
 */

import { isInside, findToplevel } from '../../core/src/index.js';
import type { GitError } from '../../core/src/index.js';
import { resolveKnownRoots } from './iyke-client.js';

export interface ResolvedRepo {
  /** Canonical, verified-real git toplevel. Use THIS as `cwd`, never the
   *  caller's raw string. */
  repo: string;
  /** The known project root that contains it (may equal `repo` itself). */
  projectRoot: string;
  /** `repo` relative to `projectRoot` — `.` for the root repo. */
  relPath: string;
}

export type ResolveOutcome = { ok: true; resolved: ResolvedRepo } | GitError;

function relPathOf(root: string, repo: string): string {
  if (root === repo) return '.';
  const rel = repo.slice(root.length).replace(/^[/\\]/, '');
  return rel.length > 0 ? rel.split(/[\\/]/).join('/') : '.';
}

/**
 * Resolve + authorize `rawRepo`. `getKnownRoots` is injectable so tests can
 * supply a fixed root set without a live shell — production code always
 * passes `resolveKnownRoots` (the default).
 */
export async function resolveRepo(
  rawRepo: string,
  getKnownRoots: () => Promise<
    { ok: true; roots: readonly string[] } | { ok: false; message: string }
  > = resolveKnownRoots
): Promise<ResolveOutcome> {
  const top = await findToplevel(rawRepo);
  if (top.ok !== true) return top;

  const rootsOutcome = await getKnownRoots();
  if (rootsOutcome.ok !== true) {
    return {
      ok: false,
      reason: 'repo-not-known',
      message: `cannot verify "${rawRepo}" against known project roots: ${rootsOutcome.message}`,
      path: rawRepo,
    };
  }

  for (const root of rootsOutcome.roots) {
    if (isInside(root, top.repo)) {
      return {
        ok: true,
        resolved: { repo: top.repo, projectRoot: root, relPath: relPathOf(root, top.repo) },
      };
    }
  }

  return {
    ok: false,
    reason: 'repo-not-known',
    message: `"${top.repo}" is not inside any known Ikenga project root`,
    path: top.repo,
  };
}
