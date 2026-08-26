/**
 * com.ikenga.git · git-core — `git branch --list --format=…` parser.
 *
 * The format (`BRANCH_FORMAT` in `argv.ts`) uses for-each-ref atoms with `%00`
 * hex escapes, so fields are NUL-separated exactly like `log`'s. Records stay
 * NEWLINE-separated, which is safe here and only here: git forbids a newline
 * in a ref name, so no field can forge a record boundary.
 *
 * Field order:
 *   0 %(refname)                        full ref
 *   1 %(refname:short)                  short name
 *   2 %(objectname)                     tip sha
 *   3 %(HEAD)                           `*` when checked out here, else a space
 *   4 %(upstream:short)                 configured upstream, or empty
 *   5 %(upstream:track,nobracket)       `ahead 1, behind 2` | `gone` | empty
 *   6 %(worktreepath)                   path when checked out in a worktree
 *   7 %(contents:subject)               tip commit subject
 *
 * ── On `%(upstream:track)` and why it is ADVISORY ────────────────────────────
 * That atom's text ("ahead", "behind", "gone") is marked for translation in
 * git. Under a non-English locale — which git-core does NOT force, because
 * forcing `LC_ALL=C` would also change the language of every error message the
 * user sees in the details disclosure — the words change and the numbers do
 * not. `parseTrack` therefore extracts numbers positionally where it can and
 * returns nulls where it cannot, and `BranchInfo.ahead/behind` built from it
 * are best-effort.
 *
 * The EXACT path is `git rev-list --left-right --count <upstream>...<branch>`
 * (`argv.revListLeftRightCount`) — one spawn per branch that has an upstream.
 * `branch.list` is not a hot path; WP-04 should prefer the exact path and use
 * these values only as an optimistic first paint.
 */

import { BRANCH_FIELD_COUNT } from '../argv.js';
import type { BranchInfo, CommitSummary } from '../rpc.js';

const NUL = '\u0000';

export interface ParsedBranch {
  fullRef: string;
  name: string;
  headSha: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  /** Raw `%(upstream:track,nobracket)`, kept verbatim for diagnostics. */
  trackRaw: string;
  /** Best-effort from `trackRaw` — see the header note. Null when unknown. */
  ahead: number | null;
  behind: number | null;
  /** True when `trackRaw` is `gone`: the upstream ref no longer exists. */
  upstreamGone: boolean;
  worktreePath: string | null;
  subject: string;
}

/**
 * Extract ahead/behind counts from a `%(upstream:track,nobracket)` value.
 *
 * Recognised: `ahead N`, `behind N`, `ahead N, behind M`, `gone`, empty.
 * An unrecognised (translated) string yields nulls rather than zeros —
 * reporting "0 ahead, 0 behind" for an unparsed value would render a branch
 * with 12 unpushed commits as fully synced, which is worse than rendering
 * "unknown".
 */
export function parseTrack(raw: string): {
  ahead: number | null;
  behind: number | null;
  gone: boolean;
} {
  const text = raw.trim();
  if (text.length === 0) return { ahead: null, behind: null, gone: false };
  if (text === 'gone') return { ahead: null, behind: null, gone: true };

  const ahead = /ahead\s+(\d+)/i.exec(text);
  const behind = /behind\s+(\d+)/i.exec(text);
  if (!ahead && !behind) return { ahead: null, behind: null, gone: false };

  return {
    ahead: ahead ? Number.parseInt(ahead[1] as string, 10) : 0,
    behind: behind ? Number.parseInt(behind[1] as string, 10) : 0,
    gone: false,
  };
}

/** Parse the newline-separated, NUL-field output of `argv.branchList`. */
export function parseBranchList(raw: string): ParsedBranch[] {
  const out: ParsedBranch[] = [];

  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const f = line.split(NUL);
    if (f.length < BRANCH_FIELD_COUNT) continue; // truncated record — skip, never guess

    const fullRef = f[0] ?? '';
    const track = parseTrack(f[5] ?? '');
    const upstream = f[4] ?? '';
    const worktreePath = f[6] ?? '';

    out.push({
      fullRef,
      name: f[1] ?? '',
      headSha: f[2] ?? '',
      // `%(HEAD)` is `*` for the branch checked out in THIS worktree and a
      // single space otherwise — not empty, so a truthiness check on the raw
      // field is always true.
      isHead: (f[3] ?? '').trim() === '*',
      isRemote: fullRef.startsWith('refs/remotes/'),
      upstream: upstream.length > 0 ? upstream : null,
      trackRaw: f[5] ?? '',
      ahead: track.ahead,
      behind: track.behind,
      upstreamGone: track.gone,
      worktreePath: worktreePath.length > 0 ? worktreePath : null,
      subject: f[7] ?? '',
    });
  }

  return out;
}

/**
 * Lift a `ParsedBranch` into the frozen `BranchInfo` shape.
 *
 * `lastCommit` is supplied by the caller (one `log -1` per branch, or a
 * batched lookup) rather than parsed here: `BranchInfo.lastCommit` is a full
 * `CommitSummary` including parents and co-authors, and for-each-ref cannot
 * emit that unambiguously.
 *
 * `worktreePath` is passed through rather than recomputed. It is the field
 * that stops the UI offering a checkout git will refuse: a branch already
 * checked out in a linked worktree cannot be checked out again.
 */
export function toBranchInfo(
  parsed: ParsedBranch,
  lastCommit: CommitSummary | null = null
): BranchInfo {
  return {
    name: parsed.name,
    fullRef: parsed.fullRef,
    isHead: parsed.isHead,
    isRemote: parsed.isRemote,
    upstream: parsed.upstream,
    ahead: parsed.upstream === null ? null : parsed.ahead,
    behind: parsed.upstream === null ? null : parsed.behind,
    lastCommit,
    worktreePath: parsed.worktreePath,
  };
}
