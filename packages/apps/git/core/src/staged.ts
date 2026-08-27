/**
 * com.ikenga.git · git-core — **the explicit-path commit assertion** (G-04).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `git commit` records the INDEX. "Explicit paths" is an ASSERTION about    │
 * │ what is in the index, checked before committing — never a pathspec.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ── The bug this module exists to make impossible (R6, rpc.ts DELTA 7) ──────
 *
 * 01-plan.md §MCP threat model promises `git_commit` "stages nothing
 * implicitly: it commits only the explicit path list". The first
 * implementation spelled that `git commit -F - --only -- <paths>` — and
 * `--only`/pathspec does NOT mean "restrict the commit to the staged content
 * of these paths". It means "commit the WORKING TREE content of these paths,
 * ignoring what the index holds for them" (git-commit(1): with paths, the
 * command "ignore[s] contents staged in the index"). So for a porcelain `MM`
 * file — staged at revision B1, then edited to B2 in the editor — the commit
 * recorded **B2**, silently, while this pkg's own staged-diff pane showed B1.
 * A user reviewing the staged diff and hitting Commit got bytes they had never
 * seen. Reproduced end to end (real git, real sidecar process) before the fix.
 *
 * Narrowing was therefore never available as a repair: any pathspec form has
 * this property. The honest containment is to REFUSE. `assertStagedSetMatches`
 * reads the staged set and requires it to equal the caller's list; on any
 * difference it returns `staged-set-mismatch` and NOTHING is committed. The
 * caller (a human in the UI, or Chi through `git_commit`) then stages or
 * unstages until the two agree — which is the only way to make "I committed
 * exactly these paths" and "I committed exactly what I reviewed" the same
 * sentence.
 *
 * ── Why it lives in git-core and not in the sidecar ─────────────────────────
 *
 * Three callers need it and only two are the sidecar: the one-shot RPC
 * sidecar (WP-04), the MCP's `git_commit` (WP-05), and any test that drives
 * git-core directly. Putting it beside the argv builder is what makes "the UI
 * committed this" and "Chi's tool committed this" provably the same operation
 * (01-plan.md §MCP threat model) instead of two implementations that agree
 * today.
 *
 * Nothing here throws for an expected condition (index.ts §invariant): a
 * mismatch, an unreadable repo and a failed spawn are all `GitError` values.
 */

import * as argv from './argv.js';
import { gitError } from './errors.js';
import { run } from './exec.js';
import type { GitError } from './rpc.js';

/** `-z` field terminator. Written as an escape, never as a literal byte —
 *  a raw NUL in a source file is invisible in every diff view. */
const NUL = '\u0000';

/**
 * Canonical form for comparing a repo-relative path against git's own output.
 *
 * git emits clean POSIX repo-relative paths under `-z` (no quoting, no `./`,
 * no trailing slash). A caller's list has been through `PathspecSchema`
 * (absolute paths, `..`, NUL and leading `-` already rejected) but may still
 * carry cosmetic differences a human or a UI introduced. Normalising both
 * sides means `./src/a.ts`, `src//a.ts` and `src/a.ts` are one path rather
 * than three spurious mismatches.
 *
 * Deliberately NOT done here: symlink resolution, case folding, and unicode
 * normalisation. Each would make two genuinely different index entries compare
 * equal on some filesystem, and this function's whole job is to be strict.
 */
export function normalizeRelPath(p: string): string {
  let out = p.replace(/\/{2,}/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/** Sorted, de-duplicated, normalised — the comparable form of a path set. */
function canonicalSet(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizeRelPath))].sort();
}

/**
 * Read the repo's staged set: every path `git commit` would record right now.
 *
 * `git diff --cached --name-only -z` with git's default rename detection, so a
 * staged rename reports its DESTINATION path only — matching
 * `status --porcelain=v2`, whose rename entries are what `FileChange.path`
 * carries (`rpc.ts` §3.1). The read is `--no-optional-locks` (from `GLOBALS`),
 * so it cannot fight the user's own agents for `.git/index.lock` (G-13).
 *
 * An unborn branch (no HEAD yet) still works: `--cached` diffs against the
 * empty tree, so a fresh `git init` + `git add` reports its staged paths
 * rather than failing.
 */
export async function readStagedPaths(
  repo: string
): Promise<{ ok: true; paths: string[] } | GitError> {
  const res = await run('git', argv.diffCachedNameOnly(), { cwd: repo });
  if (res.ok !== true) return res;
  // `-z` is NUL-TERMINATED, not NUL-separated: the last field is followed by a
  // NUL, so a naive split yields a trailing empty string. Filtering empties
  // also covers the no-staged-changes case, where stdout is '' exactly.
  const paths = res.outcome.stdout.split(NUL).filter((s) => s.length > 0);
  return { ok: true, paths };
}

/** What {@link assertStagedSetMatches} found. Exported for tests and for a
 *  future UI affordance that offers "stage the missing ones" — the RPC surface
 *  carries only `GitError.message`, deliberately (G-RPC is frozen). */
export interface StagedSetDiff {
  /** Staged in the repo but NOT named by the caller — these would be swept
   *  into the commit. */
  extra: string[];
  /** Named by the caller but NOT staged — these would silently not be in the
   *  commit at all. */
  missing: string[];
}

/** Pure set comparison, split out so it is testable without a repo. */
export function compareStagedSet(
  staged: readonly string[],
  requested: readonly string[]
): StagedSetDiff {
  const s = new Set(canonicalSet(staged));
  const r = new Set(canonicalSet(requested));
  return {
    extra: [...s].filter((p) => !r.has(p)).sort(),
    missing: [...r].filter((p) => !s.has(p)).sort(),
  };
}

/**
 * THE ASSERTION. Returns `null` when the repo's staged set is exactly
 * `requested`, and a `staged-set-mismatch` `GitError` otherwise — at which
 * point the caller must not commit.
 *
 * `requested` empty is NOT a special case here and must not be passed: the
 * "commit whatever is staged" meaning of `paths: []` is a UI-only affordance
 * (`rpc.ts` `CommitCreateArgs`, Q3) and the caller decides to skip the
 * assertion for it. The MCP tool's own schema forbids an empty list, so
 * `git_commit` always asserts.
 *
 * The message names both sides, capped, because "your staged set doesn't match"
 * with no nouns in it is not an error a person can act on.
 */
export async function assertStagedSetMatches(
  repo: string,
  requested: readonly string[]
): Promise<GitError | null> {
  const staged = await readStagedPaths(repo);
  if (staged.ok !== true) return staged;

  const { extra, missing } = compareStagedSet(staged.paths, requested);
  if (extra.length === 0 && missing.length === 0) return null;

  const parts: string[] = [];
  if (extra.length > 0) parts.push(`also staged: ${summarise(extra)}`);
  if (missing.length > 0) parts.push(`requested but not staged: ${summarise(missing)}`);
  return gitError(
    'staged-set-mismatch',
    `nothing was committed — the staged set is not exactly the paths requested (${parts.join('; ')})`,
    // `path` carries the first offender so a UI can scroll to it without
    // re-parsing the message.
    { path: (missing[0] ?? extra[0]) as string }
  );
}

const MAX_LISTED = 10;

function summarise(paths: readonly string[]): string {
  if (paths.length <= MAX_LISTED) return paths.join(', ');
  return `${paths.slice(0, MAX_LISTED).join(', ')} (+${String(paths.length - MAX_LISTED)} more)`;
}
