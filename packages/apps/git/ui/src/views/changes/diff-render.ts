// com.ikenga.git · diff DOM renderer (WP-07, D9)
//
// Builds the actual diff pane DOM from parsed hunks (diff-parse.ts). Two
// modes over the same parse: side-by-side (default, D-01) and unified. Both
// build a flat CSS-grid list of row cells rather than nested per-line
// elements, and both build everything into one `DocumentFragment` before a
// single `appendChild` — the DoD's "2k-line file under 200ms" budget is
// dominated by layout/reflow cost, and one attach beats thousands.
//
// No syntax highlighting: D-01's mockup shows illustrative token colouring,
// but tokenizing arbitrary source per-language is out of scope for a diff
// pane whose job is "what changed", and every language the workspace touches
// (Rust, TS, SQL, shell) would need its own lexer. Deferred, not forgotten —
// flagged as an open follow-up, not silently dropped.

import type { DiffHunk } from './diff-parse.js';
import { pairSideBySide } from './diff-parse.js';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function lineNo(n: number | null): HTMLElement {
  return el('span', 'git-diff-ln', n === null ? '' : String(n));
}

/** Side-by-side (D-01 default): one hunk header per hunk, then a 4-column
 *  grid — old-no / old-code / new-no / new-code — one CSS grid row per
 *  paired line (diff-parse.ts's `pairSideBySide`). */
export function renderDiffSideBySide(hunks: readonly DiffHunk[]): HTMLElement {
  const root = el('div', 'git-diff git-diff--split');
  const frag = document.createDocumentFragment();
  for (const hunk of hunks) {
    frag.appendChild(el('div', 'git-diff-hunk', hunk.header));
    const grid = el('div', 'git-diff-grid git-diff-grid--split');
    for (const row of pairSideBySide(hunk.lines)) {
      grid.appendChild(lineNo(row.left?.oldNo ?? null));
      grid.appendChild(sideCell(row.left, 'left'));
      grid.appendChild(lineNo(row.right?.newNo ?? null));
      grid.appendChild(sideCell(row.right, 'right'));
    }
    frag.appendChild(grid);
  }
  root.appendChild(frag);
  return root;
}

function sideCell(
  line: { kind: 'context' | 'add' | 'del'; text: string; noNewline?: boolean } | null,
  side: 'left' | 'right'
): HTMLElement {
  const cls = ['git-diff-code', `git-diff-code--${side}`];
  if (!line) {
    cls.push('git-diff-code--nil');
    return el('span', cls.join(' '));
  }
  if (line.kind === 'add') cls.push('git-diff-code--add');
  if (line.kind === 'del') cls.push('git-diff-code--del');
  const cell = el('span', cls.join(' '), line.text.length > 0 ? line.text : ' ');
  if (line.noNewline) cell.title = 'No newline at end of file';
  return cell;
}

/** Unified: one hunk header, then a 3-column grid — old-no / new-no / code —
 *  one row per raw line in emission order (no pairing). */
export function renderDiffUnified(hunks: readonly DiffHunk[]): HTMLElement {
  const root = el('div', 'git-diff git-diff--unified');
  const frag = document.createDocumentFragment();
  for (const hunk of hunks) {
    frag.appendChild(el('div', 'git-diff-hunk', hunk.header));
    const grid = el('div', 'git-diff-grid git-diff-grid--unified');
    for (const line of hunk.lines) {
      grid.appendChild(lineNo(line.oldNo));
      grid.appendChild(lineNo(line.newNo));
      const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
      const cls = ['git-diff-code', `git-diff-code--${line.kind}`];
      const cell = el('span', cls.join(' '));
      cell.appendChild(el('span', 'git-diff-sign', sign));
      cell.appendChild(document.createTextNode(line.text));
      if (line.noNewline) cell.title = 'No newline at end of file';
      grid.appendChild(cell);
    }
    frag.appendChild(grid);
  }
  root.appendChild(frag);
  return root;
}

export function renderDiffEmpty(text: string): HTMLElement {
  return el('div', 'git-empty-inline', text);
}
