// com.ikenga.git · unified-diff parser (WP-07, D9)
//
// `FileDiff.patch` is git's own unified-patch text, UNPARSED by the sidecar
// on purpose (rpc.ts §3.8 comment: every candidate diff renderer ingests
// unified text, so pre-parsing on the sidecar side would be work thrown
// away). This module is the "candidate renderer" the comment refers to — see
// index.ts's header for the D9 decision writeup (why a hand-rolled parser
// over a diff library).
//
// Parses ONLY the hunk bodies (`@@ ... @@` and the lines under them). File
// headers (`diff --git`, `index …`, `---`/`+++`, `rename from/to`,
// `similarity index`, mode changes) carry no per-line data this view needs —
// `FileDiff.origPath`/`isNew`/`isDeleted`/`binary` already surface the facts
// those headers encode, structurally, from numstat + patch-header regexes on
// the sidecar side (mcp/src/diff.ts, sidecar/src/handlers.ts). A rename-only
// or mode-only change produces zero hunks; that is a valid, empty result, not
// a parse failure.

export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  /** 1-based old-side line number; null for an added line. */
  oldNo: number | null;
  /** 1-based new-side line number; null for a deleted line. */
  newNo: number | null;
  /** Line content, marker stripped. */
  text: string;
  /** Set when git's `\ No newline at end of file` immediately follows. */
  noNewline?: boolean;
}

export interface DiffHunk {
  /** Full `@@ -a,b +c,d @@ trailing-context` header line, verbatim. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Parse every hunk out of a unified patch. Tolerant of a patch with no
 *  hunks at all (rename/mode-only) — returns `[]`, never throws: patch text
 *  came from git itself, and a malformed line should degrade (skipped) rather
 *  than take the diff pane down. */
export function parsePatch(patch: string): DiffHunk[] {
  const lines = patch.split('\n');
  const hunks: DiffHunk[] = [];
  let i = 0;

  while (i < lines.length) {
    const headerLine = lines[i];
    const m = headerLine !== undefined ? HUNK_HEADER_RE.exec(headerLine) : null;
    if (!m) {
      i++;
      continue;
    }
    const oldStart = Number(m[1]);
    const oldLines = m[2] !== undefined ? Number(m[2]) : 1;
    const newStart = Number(m[3]);
    const newLines = m[4] !== undefined ? Number(m[4]) : 1;
    const hunk: DiffHunk = { header: headerLine as string, oldStart, oldLines, newStart, newLines, lines: [] };
    i++;

    let oldNo = oldStart;
    let newNo = newStart;
    while (i < lines.length) {
      const l = lines[i];
      if (l === undefined || l.startsWith('@@ ')) break;
      if (l.startsWith('\\')) {
        // "\ No newline at end of file" — annotate the previous line, don't
        // advance either counter.
        const prev = hunk.lines[hunk.lines.length - 1];
        if (prev) prev.noNewline = true;
        i++;
        continue;
      }
      const marker = l.charAt(0);
      const text = l.length > 0 ? l.slice(1) : '';
      if (marker === '+') {
        hunk.lines.push({ kind: 'add', oldNo: null, newNo: newNo, text });
        newNo++;
      } else if (marker === '-') {
        hunk.lines.push({ kind: 'del', oldNo: oldNo, newNo: null, text });
        oldNo++;
      } else {
        // Context. Git always prefixes a real context line with a space; an
        // empty `l` (a genuinely blank context line some tools emit without
        // the leading space) falls through to the same branch.
        hunk.lines.push({ kind: 'context', oldNo: oldNo, newNo: newNo, text });
        oldNo++;
        newNo++;
      }
      i++;
    }
    hunks.push(hunk);
  }

  return hunks;
}

export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Pair a hunk's lines into left/right rows for the side-by-side renderer.
 * Context lines pair with themselves; a run of consecutive deletes followed
 * by a run of consecutive adds (git's own emission order) zips 1:1, with the
 * longer run's tail left blank on the other side. This is the same
 * hunk-local heuristic every unified→side-by-side tool uses without a full
 * word-diff — good enough for "which line changed", which is all a v1 diff
 * pane promises.
 */
export function pairSideBySide(lines: readonly DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as DiffLine;
    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (i < lines.length && lines[i]?.kind === 'del') {
      dels.push(lines[i] as DiffLine);
      i++;
    }
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]?.kind === 'add') {
      adds.push(lines[i] as DiffLine);
      i++;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}
