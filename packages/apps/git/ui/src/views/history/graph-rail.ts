/**
 * com.ikenga.git · History — the graph rail (WP-08).
 *
 * Draws a `GraphLayout` as one absolutely-positioned SVG behind the commit
 * rows. Rows are a FIXED height, which is the whole reason a single overlay
 * works: row `i`'s dot is always at `y = i * ROW_HEIGHT + ROW_HEIGHT / 2`, so
 * the rail and the list can never drift apart, and appending a page is a
 * re-draw of one element rather than a reflow of hundreds.
 *
 * Colour comes from `--git-lane-N` custom properties (history.css), cycled by
 * column. Per brand-spec: token vars only, no hex literals.
 */

import type { GraphEdge, GraphLayout, GraphNode } from './graph-layout';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Must match `--git-hist-row-h` in history.css. */
export const ROW_HEIGHT = 26;
/** Horizontal pitch between lanes. */
export const COLUMN_WIDTH = 13;
/** Left/right breathing room around the lanes. */
export const RAIL_PADDING = 9;
/** How many `--git-lane-N` colours history.css defines. */
const LANE_COLOURS = 6;

export function railWidth(layout: GraphLayout): number {
  return RAIL_PADDING * 2 + Math.max(1, layout.columns) * COLUMN_WIDTH;
}

function laneX(column: number): number {
  return RAIL_PADDING + column * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}

function rowY(row: number): number {
  return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/**
 * The path for one edge: leave the child's dot, bend into the lane the edge
 * occupies, run straight down it, then bend into the parent's dot.
 *
 * The two bends are quadratic curves capped at half a row so an edge between
 * adjacent rows curves rather than kinking, and a long edge is a clean
 * vertical for all but its first and last row.
 */
function edgePath(edge: GraphEdge): string {
  const xFrom = laneX(edge.fromColumn);
  const yFrom = rowY(edge.fromRow);
  const xLane = laneX(edge.column);
  const xTo = laneX(edge.toColumn);
  const yTo = rowY(edge.toRow);
  const span = Math.max(1, yTo - yFrom);

  const parts: string[] = [`M ${String(xFrom)} ${String(yFrom)}`];
  let y = yFrom;

  if (xLane !== xFrom) {
    const bend = Math.min(ROW_HEIGHT, span / 2);
    parts.push(`Q ${String(xFrom)} ${String(yFrom + bend)} ${String(xLane)} ${String(yFrom + bend)}`);
    y = yFrom + bend;
  }

  if (xTo !== xLane) {
    const bend = Math.min(ROW_HEIGHT, Math.max(0, yTo - y) / 2);
    parts.push(`L ${String(xLane)} ${String(yTo - bend)}`);
    parts.push(`Q ${String(xLane)} ${String(yTo)} ${String(xTo)} ${String(yTo)}`);
  } else {
    parts.push(`L ${String(xTo)} ${String(yTo)}`);
  }

  return parts.join(' ');
}

function laneClass(column: number): string {
  return `git-hist-rail__lane--${String(column % LANE_COLOURS)}`;
}

function dotClass(node: GraphNode): string {
  if (node.isMerge) return 'git-hist-rail__dot git-hist-rail__dot--merge';
  if (node.isRoot) return 'git-hist-rail__dot git-hist-rail__dot--root';
  return 'git-hist-rail__dot';
}

/**
 * Build the rail for a layout. `highlightSha` gets an emphasised dot so the
 * selected commit is findable in a 600-row rail without scanning the text.
 */
export function renderRail(layout: GraphLayout, highlightSha: string | null): SVGSVGElement {
  const width = railWidth(layout);
  const height = Math.max(ROW_HEIGHT, layout.nodes.length * ROW_HEIGHT);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'git-hist-rail');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  // Edges first so dots sit on top of them.
  for (const edge of layout.edges) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', edgePath(edge));
    path.setAttribute(
      'class',
      `git-hist-rail__edge ${laneClass(edge.column)}${edge.dangling ? ' git-hist-rail__edge--dangling' : ''}`
    );
    svg.appendChild(path);
  }

  for (const node of layout.nodes) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(laneX(node.column)));
    dot.setAttribute('cy', String(rowY(node.row)));
    dot.setAttribute('r', node.isMerge ? '4' : '3.25');
    dot.setAttribute(
      'class',
      `${dotClass(node)} ${laneClass(node.column)}${node.sha === highlightSha ? ' git-hist-rail__dot--selected' : ''}`
    );
    svg.appendChild(dot);
  }

  return svg;
}
