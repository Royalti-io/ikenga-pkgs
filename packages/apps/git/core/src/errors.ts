/**
 * com.ikenga.git · git-core — the frozen error vocabulary, constructed.
 *
 * `rpc.ts` (G-RPC) owns the SHAPE — `{ ok:false, reason, message, … }` and the
 * 19-member `GitErrorReason` union. This module owns the two things a shape
 * cannot express:
 *
 *   1. **Construction.** One helper per failure family, so a reason is never
 *      spelled as a bare string at a call site and `message` is never a raw
 *      git stderr line (which can contain a URL with an embedded credential).
 *   2. **Classification.** Turning a non-zero `git` exit into the right reason.
 *      `index-locked` and `operation-in-progress` are the two that matter:
 *      both are ordinary, recoverable, concurrent-agent situations (G-13) that
 *      must read as named UI states, and both arrive from git as nothing but
 *      an English stderr string.
 *
 * Nothing here throws. Every git-core entry point returns `GitError` — the
 * plan is explicit that a no-root state is "never a throw, never a failed git
 * spawn", and the same discipline applied to every failure keeps the sidecar's
 * dispatch free of try/catch-shaped control flow.
 */

import type { z } from 'zod';
import { MAX_STDERR_CHARS, type GitError, type GitErrorReason } from './rpc.js';
import { offendingPath, reasonForParseFailure } from './rpc.js';

// ─────────────────────────────────────────────────────────────────────────────
// Redaction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns that must never survive into a `GitError`.
 *
 * The realistic leak is `remote: fatal: unable to access
 * 'https://user:ghp_xxx@github.com/…'` — git echoes the remote URL with the
 * credential embedded when a helper supplied one inline. `gh` can echo a token
 * on an auth error. Both land in stderr, and stderr is rendered (behind a
 * disclosure) by the UI.
 */
const REDACTIONS: readonly { re: RegExp; with: string }[] = [
  // userinfo in any URL: scheme://user:secret@host → scheme://user:***@host
  { re: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+):[^\s/@]*@/gi, with: '$1:***@' },
  // GitHub token families (classic, fine-grained, oauth, app, refresh).
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, with: 'gh*_***' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, with: 'github_pat_***' },
  // Anything that names itself a token/password in a key=value tail.
  { re: /\b(token|password|passwd|secret)=([^\s&]+)/gi, with: '$1=***' },
];

/** Strip credential-shaped substrings. Applied to every `message`/`stderr`. */
export function redact(text: string): string {
  let out = text;
  for (const r of REDACTIONS) out = out.replace(r.re, r.with);
  return out;
}

/** Redact, collapse to something renderable, and cap at `MAX_STDERR_CHARS`. */
export function trimStderr(stderr: string): string {
  const clean = redact(stderr).trimEnd();
  return clean.length > MAX_STDERR_CHARS
    ? `${clean.slice(0, MAX_STDERR_CHARS)}\n… (${clean.length - MAX_STDERR_CHARS} more chars)`
    : clean;
}

/**
 * First non-empty stderr line, for the primary error line. git puts the useful
 * sentence first and the advice block after; showing the whole thing in the
 * headline is what makes a git UI feel like a terminal that failed.
 */
export function firstLine(stderr: string): string {
  for (const raw of redact(stderr).split('\n')) {
    const line = raw.trim();
    if (line.length > 0) return line;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

export interface GitErrorExtra {
  exitCode?: number | null;
  stderr?: string | null;
  path?: string | null;
  ownerRepo?: string | null;
  retries?: number;
}

/** The one constructor. Every other helper in this file funnels through it. */
export function gitError(
  reason: GitErrorReason,
  message: string,
  extra: GitErrorExtra = {}
): GitError {
  const err: GitError = { ok: false, reason, message: redact(message) };
  if (extra.exitCode !== undefined) err.exitCode = extra.exitCode;
  if (extra.stderr !== undefined && extra.stderr !== null) err.stderr = trimStderr(extra.stderr);
  else if (extra.stderr === null) err.stderr = null;
  if (extra.path !== undefined) err.path = extra.path;
  if (extra.ownerRepo !== undefined) err.ownerRepo = extra.ownerRepo;
  if (extra.retries !== undefined) err.retries = extra.retries;
  return err;
}

/**
 * Map a Zod failure on an args schema onto `unsafe-argument` vs `invalid-args`.
 *
 * Delegates the decision to `reasonForParseFailure` in the frozen contract —
 * the point of DELTA 5 is that the sidecar and the MCP classify identically,
 * which only holds if both call the same function. `path` carries the dotted
 * location of the first hardening-rule failure so verification 6 can assert on
 * WHICH argument was rejected, not merely that something was.
 */
export function fromZodError(error: z.ZodError): GitError {
  const reason = reasonForParseFailure(error.issues);
  const path = offendingPath(error.issues);
  const first = error.issues[0];
  const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  const detail = first ? first.message : 'invalid arguments';
  return gitError(reason, `${where}${detail}`, { path });
}

/** G-11: a pathspec whose real owner is a different toplevel. */
export function crossRepoPath(path: string, targetRepo: string, ownerRepo: string | null): GitError {
  return gitError(
    'cross-repo-path',
    ownerRepo
      ? `"${path}" belongs to ${ownerRepo}, not to ${targetRepo}`
      : `"${path}" is not inside ${targetRepo}`,
    { path, ownerRepo }
  );
}

/** G-02: an argument that would be read as an option, or escapes the repo. */
export function unsafeArgument(path: string, why: string): GitError {
  return gitError('unsafe-argument', why, { path });
}

/** G-02 rule 1: a subcommand that is not on the hardcoded allowlist. */
export function notAllowed(subcommand: string): GitError {
  return gitError(
    'not-allowed',
    `git subcommand "${subcommand}" is not on the git-core allowlist`,
    { path: subcommand }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signatures of a held `.git/index.lock`. git's wording has been stable for
 * many releases; both the "Another git process" advice block and the bare
 * "Unable to create … .lock: File exists" form appear in the wild.
 */
const INDEX_LOCK_RE =
  /(unable to create '[^']*index\.lock': File exists|Another git process seems to be running|fatal: Unable to create '[^']*\.lock': File exists)/i;

/** A sequenced operation is mid-flight; refuse rather than half-apply (G-13). */
const IN_PROGRESS_RE =
  /(you have unmerged files|cannot .* because you have unmerged files|it seems that there is already a rebase|a (rebase|merge|cherry-pick|revert|bisect) is (already )?in progress|You are in the middle of a)/i;

/** Working tree state blocks the operation (checkout over local changes, …). */
const DIRTY_TREE_RE =
  /(Your local changes to the following files would be overwritten|would be overwritten by (checkout|merge)|Please commit your changes or stash them)/i;

/**
 * Classify a non-zero `git` exit.
 *
 * Order matters: `index-locked` is checked first because a lock failure can be
 * reported alongside other noise, and it is the one the UI must render as
 * "another process is writing to this repo — retrying" rather than as an error
 * at all.
 */
export function classifyGitFailure(exitCode: number | null, stderr: string): GitErrorReason {
  if (INDEX_LOCK_RE.test(stderr)) return 'index-locked';
  if (IN_PROGRESS_RE.test(stderr)) return 'operation-in-progress';
  if (DIRTY_TREE_RE.test(stderr)) return 'dirty-tree';
  if (/not a git repository/i.test(stderr)) return 'not-a-repository';
  if (/(permission denied|could not open|cannot access|No such file or directory)/i.test(stderr)) {
    // Only when git itself could not read the tree — a missing PATHSPEC is a
    // normal `git-failed`, so require the phrasing git uses for I/O.
    if (/(error: (open|unable to)|fatal: (could not|cannot) (open|read|access))/i.test(stderr)) {
      return 'unreadable';
    }
  }
  return 'git-failed';
}

/** Build a `GitError` from a completed, failed git invocation. */
export function fromGitFailure(exitCode: number | null, stderr: string): GitError {
  const reason = classifyGitFailure(exitCode, stderr);
  const headline =
    reason === 'index-locked'
      ? 'another process is writing to this repo'
      : firstLine(stderr) || `git exited with code ${String(exitCode)}`;
  return gitError(reason, headline, { exitCode, stderr });
}
