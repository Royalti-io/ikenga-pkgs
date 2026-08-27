/**
 * com.ikenga.git · git-core — `git status --porcelain=v2 --branch -z` parser.
 *
 * One invocation yields everything `RepoSnapshot` needs except the last commit:
 * head sha, branch, upstream, ahead/behind, stash count, and every changed
 * path with its index-side and worktree-side status
 * (02-research-external.md [17]).
 *
 * `-z` is not a nicety. Without it git QUOTES any path containing a space, a
 * quote, a newline or a non-ASCII byte — C-style, honouring `core.quotepath` —
 * and the parser has to implement C unquoting to get back a filename. With
 * `-z`, paths arrive raw and NUL-terminated, and a NUL cannot occur in a
 * pathname on any platform this ships to.
 *
 * Grammar (git-status(1), "Porcelain Format Version 2"):
 *
 *   # branch.oid       <sha> | (initial)
 *   # branch.head      <name> | (detached)
 *   # branch.upstream  <ref>                 ← only when an upstream is set
 *   # branch.ab        +<ahead> -<behind>    ← only when an upstream is set
 *   # stash            <n>                   ← only with --show-stash
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> NUL <origPath>
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 *   ? <path>
 *   ! <path>
 *
 * The `2` line is the one that bites: in `-z` mode its two paths are separated
 * by a NUL, so a rename record spans TWO chunks of the split. A parser that
 * treats every chunk as one entry silently turns the rename source into a
 * phantom entry whose first character is a path character.
 */

import type { ChangeKind, FileChange, GitStatusCode } from '../rpc.js';

const NUL = '\u0000';

/** Status codes git can put in either half of `<XY>`. */
const STATUS_CODES = new Set(['.', 'M', 'T', 'A', 'D', 'R', 'C', 'U']);

function asStatusCode(ch: string | undefined): GitStatusCode {
  return ch !== undefined && STATUS_CODES.has(ch) ? (ch as GitStatusCode) : '.';
}

/**
 * Split off exactly `n` space-separated tokens, returning them plus the
 * untouched remainder.
 *
 * A path may contain spaces, so the remainder must never be re-split. This is
 * why the field counts below are spelled out per line type rather than the
 * parser doing a naive `split(' ')`.
 */
function splitFields(line: string, n: number): { fields: string[]; rest: string } {
  const fields: string[] = [];
  let i = 0;
  for (let f = 0; f < n; f += 1) {
    const sp = line.indexOf(' ', i);
    if (sp === -1) {
      fields.push(line.slice(i));
      return { fields, rest: '' };
    }
    fields.push(line.slice(i, sp));
    i = sp + 1;
  }
  return { fields, rest: line.slice(i) };
}

export interface ParsedStatus {
  /** `# branch.oid`. Null on an unborn branch, where git reports `(initial)`. */
  headSha: string | null;
  /** `# branch.head`. Null when git reports `(detached)`. */
  branch: string | null;
  detached: boolean;
  /** `# branch.upstream`, absent when no upstream is configured. */
  upstream: string | null;
  /** `# branch.ab`. BOTH null when there is no upstream — which is a real
   *  workspace case, not an error. For ahead/behind against an arbitrary base,
   *  `rev-list --left-right --count` is the primitive (02-research [21]). */
  ahead: number | null;
  behind: number | null;
  /** `# stash <n>`, 0 when the header is absent. */
  stashCount: number;
  entries: FileChange[];
}

/**
 * A `FileChange` with the numstat columns unset.
 *
 * `status` cannot report added/deleted line counts — that is `--numstat`'s job
 * (`parse/numstat.ts`), and merging the two is the caller's. `binary: false`
 * here means "not yet known", and `mergeNumstat` is what makes it true. A
 * consumer that renders `binary` straight off a status parse without merging
 * will under-report; `changes.list` passes `withNumstat` for exactly this
 * reason.
 */
function baseChange(path: string, kind: ChangeKind): FileChange {
  return {
    path,
    origPath: null,
    kind,
    staged: '.',
    unstaged: '.',
    score: null,
    submodule: null,
    added: null,
    deleted: null,
    binary: false,
  };
}

/** Parse the NUL-delimited porcelain-v2 stream. */
export function parseStatus(raw: string): ParsedStatus {
  const out: ParsedStatus = {
    headSha: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
    stashCount: 0,
    entries: [],
  };

  const chunks = raw.split(NUL);
  for (let i = 0; i < chunks.length; i += 1) {
    const line = chunks[i];
    if (line === undefined || line.length === 0) continue;

    // ── Headers ────────────────────────────────────────────────────────────
    if (line.startsWith('# ')) {
      const { fields, rest } = splitFields(line, 2);
      const key = fields[1];
      if (key === 'branch.oid') out.headSha = rest === '(initial)' ? null : rest;
      else if (key === 'branch.head') {
        if (rest === '(detached)') {
          out.detached = true;
          out.branch = null;
        } else out.branch = rest;
      } else if (key === 'branch.upstream') out.upstream = rest;
      else if (key === 'branch.ab') {
        // `+<ahead> -<behind>` — note the ORDER is ahead first here, the
        // opposite of `rev-list --left-right --count`, which prints behind
        // first. Getting these backwards is the classic ahead/behind bug.
        const m = /^\+(\d+)\s+-(\d+)$/.exec(rest);
        if (m) {
          out.ahead = Number.parseInt(m[1] as string, 10);
          out.behind = Number.parseInt(m[2] as string, 10);
        }
      } else if (key === 'stash') {
        const n = Number.parseInt(rest, 10);
        if (Number.isFinite(n)) out.stashCount = n;
      }
      continue;
    }

    const type = line[0];

    // ── `1` ordinary ───────────────────────────────────────────────────────
    if (type === '1') {
      const { fields, rest } = splitFields(line, 8);
      const xy = fields[1] ?? '..';
      const entry = baseChange(rest, 'ordinary');
      entry.staged = asStatusCode(xy[0]);
      entry.unstaged = asStatusCode(xy[1]);
      entry.submodule = fields[2] ?? null;
      out.entries.push(entry);
      continue;
    }

    // ── `2` rename / copy — TWO chunks ─────────────────────────────────────
    if (type === '2') {
      const { fields, rest } = splitFields(line, 9);
      const xy = fields[1] ?? '..';
      // The rename source is the NEXT chunk, not part of this one.
      const origPath = chunks[i + 1] ?? '';
      i += 1;
      const kind: ChangeKind = xy[0] === 'C' || xy[1] === 'C' ? 'copied' : 'renamed';
      const entry = baseChange(rest, kind);
      entry.staged = asStatusCode(xy[0]);
      entry.unstaged = asStatusCode(xy[1]);
      entry.submodule = fields[2] ?? null;
      entry.origPath = origPath;
      const score = /^[RC](\d+)$/.exec(fields[8] ?? '');
      entry.score = score ? Number.parseInt(score[1] as string, 10) : null;
      out.entries.push(entry);
      continue;
    }

    // ── `u` unmerged ───────────────────────────────────────────────────────
    if (type === 'u') {
      const { fields, rest } = splitFields(line, 10);
      const xy = fields[1] ?? 'UU';
      const entry = baseChange(rest, 'unmerged');
      entry.staged = asStatusCode(xy[0]);
      entry.unstaged = asStatusCode(xy[1]);
      entry.submodule = fields[2] ?? null;
      out.entries.push(entry);
      continue;
    }

    // ── `?` untracked / `!` ignored ────────────────────────────────────────
    // These carry no `<XY>`; `kind` is the whole signal, and both status codes
    // stay `.` rather than being invented. `GitStatusCode` has no `?` member
    // by design — that would make every consumer handle a code that only ever
    // appears on entries their `kind` check already excluded.
    if (type === '?' || type === '!') {
      const path = line.slice(2);
      out.entries.push(baseChange(path, type === '?' ? 'untracked' : 'ignored'));
      continue;
    }
  }

  return out;
}

/** Partition entries the way `ChangesListResult` wants them. */
export function partitionChanges(entries: readonly FileChange[]): {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  conflicted: FileChange[];
} {
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: FileChange[] = [];
  const conflicted: FileChange[] = [];

  for (const e of entries) {
    if (e.kind === 'unmerged') {
      conflicted.push(e);
      continue;
    }
    if (e.kind === 'untracked') {
      untracked.push(e);
      continue;
    }
    if (e.kind === 'ignored') continue;
    // A file can be in BOTH lists — staged edits plus further unstaged edits is
    // the normal mid-work state, and the Changes view shows it twice on
    // purpose. Filtering to one side is how a UI loses a user's staged work.
    if (e.staged !== '.') staged.push(e);
    if (e.unstaged !== '.') unstaged.push(e);
  }

  return { staged, unstaged, untracked, conflicted };
}

/** Counts for `RepoSnapshot`. Mirrors `partitionChanges`, without the arrays. */
export function countChanges(entries: readonly FileChange[]): {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
} {
  const p = partitionChanges(entries);
  return {
    staged: p.staged.length,
    unstaged: p.unstaged.length,
    untracked: p.untracked.length,
    conflicted: p.conflicted.length,
  };
}
