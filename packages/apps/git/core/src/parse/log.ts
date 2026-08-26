/**
 * com.ikenga.git · git-core — `git log` NUL-format parser.
 *
 * The format string and the parser live in the same file on purpose: they are
 * one contract, and a field added to one and not the other is a silent
 * off-by-one across every commit in the History view. `argv.ts` imports
 * `LOG_FORMAT` from here rather than spelling it out.
 *
 * Why NUL and not tabs/pipes: a commit message can contain any character
 * except NUL, so NUL is the only delimiter that cannot be forged from inside a
 * field (02-research-external.md [19]).
 *
 * The two NUL roles — FIELD separator (from the format) and RECORD terminator
 * (from `-z`) — coexist only because the field count is fixed. Verified
 * against git 2.43.0: with `-z`, git terminates every record with NUL,
 * including the last, so splitting the whole stream yields `fields × records`
 * chunks plus one trailing empty string.
 */

import type { CoAuthor, CommitDetail, CommitSummary } from '../rpc.js';

/**
 * Field order. `%B` (raw body, multi-line) is LAST so that a body containing
 * anything at all cannot be confused with a following field.
 *
 *   0 %H  sha            6 %cn committer name
 *   1 %h  short sha      7 %ce committer email
 *   2 %P  parents        8 %ct committer date (epoch seconds)
 *   3 %an author name    9 %s  subject
 *   4 %ae author email  10 %D  ref decorations
 *   5 %at author date   11 %B  raw body
 */
export const LOG_FORMAT =
  '%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%D%x00%B';

/** Field count of `LOG_FORMAT`. */
export const LOG_FIELD_COUNT = 12;

/**
 * `LOG_FORMAT` plus `%G?` (signature status) and `%GS` (signer), inserted
 * BEFORE `%B` so the "body is last" invariant survives.
 *
 * `%G?`: G good · B bad · U good-untrusted · X expired · Y expired-key ·
 * R revoked · E cannot-check · N none. The pkg never configures signing; if
 * the user has `commit.gpgsign=true`, the inherited-env spawn signs on its own
 * (02-research-external.md [25][26]) and this is how we read that back —
 * which is what lets `commit.create` return `signed` without the user opening
 * a terminal (verification 4).
 */
export const LOG_FORMAT_WITH_SIGNATURE =
  '%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%D%x00%G?%x00%GS%x00%B';

export const LOG_FIELD_COUNT_WITH_SIGNATURE = 14;

// ─────────────────────────────────────────────────────────────────────────────
// Trailers
// ─────────────────────────────────────────────────────────────────────────────

/** `Key: value`, where Key is a git-interpret-trailers-shaped token. */
const TRAILER_RE = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/;

/** `Name <email>` — the value shape of `Co-Authored-By`. */
const IDENT_RE = /^\s*(.*?)\s*<([^>]*)>\s*$/;

export interface Trailer {
  key: string;
  value: string;
}

/**
 * Parse the trailer block of a raw commit body.
 *
 * git's own rule (`git interpret-trailers`) is "the last paragraph, if it is
 * made only of trailer-shaped lines and continuations". We implement exactly
 * that and no more:
 *   · a body with no blank line has no trailer block (a one-line message is
 *     a subject, not a trailer);
 *   · a last paragraph with one non-trailer line has no trailers at all —
 *     partial recognition is how "Fixes: x\nsome prose" turns into a phantom
 *     trailer;
 *   · a line starting with whitespace continues the previous trailer's value.
 */
export function parseTrailers(body: string): Trailer[] {
  const paragraphs = body.replace(/\r\n/g, '\n').trimEnd().split(/\n[ \t]*\n/);
  if (paragraphs.length < 2) return [];
  const last = paragraphs[paragraphs.length - 1];
  if (last === undefined) return [];

  const out: Trailer[] = [];
  for (const line of last.split('\n')) {
    if (line.length === 0) continue;
    if (/^[ \t]/.test(line)) {
      const prev = out[out.length - 1];
      if (!prev) return []; // continuation with nothing to continue ⇒ not a trailer block
      prev.value = `${prev.value}\n${line.trim()}`;
      continue;
    }
    const m = TRAILER_RE.exec(line);
    if (!m) return []; // one non-trailer line disqualifies the whole paragraph
    out.push({ key: m[1] as string, value: (m[2] as string).trim() });
  }
  return out;
}

/**
 * `Co-Authored-By` trailers, parsed into name/email.
 *
 * An EMPTY result is a real case, not an error: the attribution string is
 * user-configurable and can be suppressed (02-research-external.md [27][28]),
 * so the History view must render both "trailer present" and "trailer absent".
 * A malformed value (no angle brackets) is kept with an empty email rather
 * than dropped — dropping it would make an attribution silently vanish.
 */
export function parseCoAuthors(trailers: readonly Trailer[]): CoAuthor[] {
  const out: CoAuthor[] = [];
  for (const t of trailers) {
    if (t.key.toLowerCase() !== 'co-authored-by') continue;
    const m = IDENT_RE.exec(t.value);
    if (m) out.push({ name: (m[1] as string).trim(), email: (m[2] as string).trim() });
    else out.push({ name: t.value.trim(), email: '' });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Records
// ─────────────────────────────────────────────────────────────────────────────

/** Split a NUL stream into fixed-width records, dropping the trailing empty. */
export function chunkNulRecords(raw: string, fieldsPerRecord: number): string[][] {
  const parts = raw.split('\u0000');
  // `-z` terminates the last record, so the split leaves one empty tail chunk.
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  const out: string[][] = [];
  for (let i = 0; i + fieldsPerRecord <= parts.length; i += fieldsPerRecord) {
    out.push(parts.slice(i, i + fieldsPerRecord));
  }
  return out;
}

function intOr(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/** `%D` → the decoration list. `HEAD -> main, origin/main, tag: v1`. */
export function parseDecorations(raw: string): string[] {
  if (raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function summaryFromFields(f: readonly string[]): CommitSummary {
  const body = f[11] ?? '';
  const trailers = parseTrailers(body);
  return {
    sha: f[0] ?? '',
    shortSha: f[1] ?? '',
    // `%P` is empty for a root commit — [] is correct, not an error.
    parents: (f[2] ?? '').split(' ').filter((s) => s.length > 0),
    authorName: f[3] ?? '',
    authorEmail: f[4] ?? '',
    authorAt: intOr(f[5], 0),
    committerName: f[6] ?? '',
    committerEmail: f[7] ?? '',
    committedAt: intOr(f[8], 0),
    subject: f[9] ?? '',
    refs: parseDecorations(f[10] ?? ''),
    coAuthors: parseCoAuthors(trailers),
  };
}

/** Parse `git log -z --format=LOG_FORMAT` output into commit summaries. */
export function parseLog(raw: string): CommitSummary[] {
  return chunkNulRecords(raw, LOG_FIELD_COUNT).map(summaryFromFields);
}

/**
 * Parse a single-commit record. `withSignature` selects the 14-field layout.
 * Returns `null` for empty output — an unreachable sha is a `git-failed` at
 * the exec layer, not a parse result.
 *
 * `files` is left empty: numstat comes from a second invocation
 * (`argv.logCommitNumstat`) and is merged by the caller, because git cannot
 * emit a custom format and `--numstat` into one unambiguous NUL stream.
 */
export function parseCommitDetail(
  raw: string,
  opts: { withSignature?: boolean } = {}
): CommitDetail | null {
  const fieldCount = opts.withSignature ? LOG_FIELD_COUNT_WITH_SIGNATURE : LOG_FIELD_COUNT;
  const records = chunkNulRecords(raw, fieldCount);
  const f = records[0];
  if (!f) return null;

  const bodyIndex = fieldCount - 1;
  const base = summaryFromFields([...f.slice(0, 11), f[bodyIndex] ?? '']);
  const trailers = parseTrailers(f[bodyIndex] ?? '');

  let signature: CommitDetail['signature'] = null;
  if (opts.withSignature) {
    const status = f[11] ?? '';
    const signer = f[12] ?? '';
    // `N` = not signed. Report null rather than a "status: N" object so the UI
    // has one falsy case for "no signature" instead of two.
    if (status.length > 0 && status !== 'N') {
      signature = { status, signer: signer.length > 0 ? signer : null };
    }
  }

  return { ...base, body: f[bodyIndex] ?? '', trailers, files: [], signature };
}
