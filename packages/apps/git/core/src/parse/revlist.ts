/**
 * com.ikenga.git · git-core — `git rev-list --left-right --count` parser.
 *
 * `git rev-list --left-right --count <base>...<head>` prints two tab-separated
 * numbers: **left first, right second** — with `<base>` on the left, that is
 * `<behind>TAB<ahead>` (02-research-external.md [21]).
 *
 * The order is the opposite of `git status --porcelain=v2 --branch`'s
 * `# branch.ab +<ahead> -<behind>`. Two commands, two orders, one meaning —
 * this parser and `parse/status.ts` are the only two places that know, and
 * both say so.
 *
 * This is also the Phase-2 stale-base-hazard primitive: a large `behind` count
 * against `main` is exactly the "your branch's base is stale, do not hand-merge
 * this" warning that shell PR #106 → #114 keeps re-teaching.
 */

import type { AheadBehind } from '../rpc.js';

export interface LeftRightCount {
  /** Commits on `base` that `head` does not have. */
  behind: number;
  /** Commits on `head` that `base` does not have. */
  ahead: number;
}

/** Parse `<behind>TAB<ahead>`. Returns null for output that is not two ints. */
export function parseLeftRightCount(raw: string): LeftRightCount | null {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(raw);
  if (!m) return null;
  return {
    behind: Number.parseInt(m[1] as string, 10),
    ahead: Number.parseInt(m[2] as string, 10),
  };
}

/**
 * Assemble the `AheadBehind` result.
 *
 * `mergeBase` is null when the two histories are unrelated — `git merge-base`
 * exits 1 with no output in that case, which is not an error condition: two
 * unrelated roots in one repo is unusual but legal, and the UI should say
 * "unrelated histories" rather than showing a failed command.
 */
export function toAheadBehind(
  base: string,
  head: string,
  counts: LeftRightCount,
  mergeBaseSha: string | null
): AheadBehind {
  return {
    base,
    head,
    ahead: counts.ahead,
    behind: counts.behind,
    mergeBase: mergeBaseSha,
  };
}
