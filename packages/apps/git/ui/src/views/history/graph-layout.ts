/**
 * com.ikenga.git · History — commit-graph layout (WP-08).
 *
 * ── Why this file exists at all ─────────────────────────────────────────────
 *
 * `@gitgraph/js` is archived and unmaintained; Snyk marks it Inactive
 * (02-research-external.md [10][11]). 01-plan.md §Build-vs-buy therefore says
 * **build fresh**: "hand-rolled forbidden-columns layout (pvigier) over
 * `git log --format=%H%x00%P…`". This is that layout.
 *
 * ── The algorithm ───────────────────────────────────────────────────────────
 *
 * pvigier's family of commit-graph algorithms (02-research-external.md [12] —
 * the same family behind gitk, GitKraken and GitHub's own graph) reduces to
 * one rule:
 *
 *     For each commit, compute the set of FORBIDDEN COLUMNS — the columns
 *     already occupied at that row by an edge belonging to some other chain —
 *     and assign the lowest column that is not forbidden.
 *
 * "Occupied at that row" is exactly "there is a pending edge whose child is
 * above this row and whose parent is below it". We keep those pending edges in
 * `lanes`; the forbidden set at row `i` is `{ lane.column for lane in lanes }`
 * *at the moment row i is processed*. Every other property (no crossings,
 * columns freed for reuse when a branch ends, merges fanning out to the right)
 * falls out of that one rule plus two conventions:
 *
 *   · a commit's FIRST parent continues in the commit's own column, so the
 *     mainline stays straight;
 *   · every OTHER parent (a merge's 2nd..nth) opens a new lane at the lowest
 *     free column, so a merge visibly forks right and rejoins later.
 *
 * Cost is O(n·w) for n commits and w concurrent lanes — the bound pvigier
 * gives. `w` is tiny in practice (single digits for this workspace) and is
 * hard-capped by `maxColumns`.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * No viewport interval tree (pvigier's O(k log m) refinement). At the page
 * sizes this view uses — 500 then 200 (02-research-external.md [13], GitLens's
 * shape) — recomputing the whole layout on append is microseconds, and it is
 * the only way to stay correct: a second page can resolve edges that dangled
 * off the bottom of the first, so an incremental layout would have to patch
 * them anyway.
 *
 * ── Purity ──────────────────────────────────────────────────────────────────
 *
 * This module imports NOTHING. `GraphInputCommit` is a structural subset of
 * `CommitSummary` (rpc.ts §3.4) — a `CommitSummary[]` satisfies it as-is —
 * which keeps the layout unit-testable with zero zod/DOM/bridge weight and
 * lets `tools/history-cli.ts` drive it straight off git-core.
 */

/** The only two fields the layout needs. `CommitSummary` satisfies this. */
export interface GraphInputCommit {
  readonly sha: string;
  /** `%P`, split on space. `[]` for a root commit; 2+ for a merge. */
  readonly parents: readonly string[];
}

/** `parent` = first-parent (mainline) edge · `merge` = 2nd..nth parent. */
export type GraphEdgeKind = 'parent' | 'merge';

export interface GraphNode {
  sha: string;
  /** Index into the commit list this layout was computed from. */
  row: number;
  /** The assigned (lowest non-forbidden) column. */
  column: number;
  parents: readonly string[];
  /** More than one parent. */
  isMerge: boolean;
  /** No parents at all — a root commit, so no edge leaves the bottom. */
  isRoot: boolean;
  /**
   * True when every column below `maxColumns` was forbidden and this node had
   * to share the last one. The rail is an approximation on such a row and the
   * renderer is expected to say so rather than pretend.
   */
  clamped: boolean;
}

export interface GraphEdge {
  fromSha: string;
  fromRow: number;
  fromColumn: number;
  /**
   * `null` when the parent is not in the loaded commit list — a pagination
   * boundary, a shallow clone, or a `--path`-filtered log. This is a normal
   * state, not an error: the renderer draws the edge running off the bottom.
   */
  toSha: string | null;
  /** `rowCount` (one past the last row) when `dangling`. */
  toRow: number;
  toColumn: number;
  /** The column the edge occupies while spanning the rows in between. */
  column: number;
  kind: GraphEdgeKind;
  dangling: boolean;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Highest column index used, plus one. `0` for an empty layout. */
  columns: number;
  /**
   * Per row, the columns occupied by an edge that passes THROUGH that row —
   * it neither starts nor ends there. Sorted ascending. This is the forbidden
   * set the row's commit was assigned around, minus the lanes it consumed, and
   * it is exactly what a rail renderer draws as an uninterrupted vertical.
   */
  passThrough: number[][];
  nodeBySha: Map<string, GraphNode>;
  /** True when any row hit `maxColumns`. */
  clamped: boolean;
  /** Rows whose commit shas were dropped as duplicates before layout. */
  duplicatesDropped: number;
}

export interface GraphLayoutOptions {
  /**
   * Hard cap on lane count. Beyond this the graph is unreadable anyway and an
   * uncapped rail would push the commit text off-pane. GitKraken-style clamp:
   * everything that would need column >= maxColumns shares the last one.
   */
  maxColumns?: number;
}

export const DEFAULT_MAX_COLUMNS = 16;

/** A pending edge: a child already placed, waiting for its parent's row. */
interface Lane {
  column: number;
  targetSha: string;
  fromSha: string;
  fromRow: number;
  fromColumn: number;
  kind: GraphEdgeKind;
}

/**
 * The forbidden-column rule, in one function: the lowest column not already
 * carrying a pending edge. Returns `clamped` when the cap forced a share.
 */
function lowestFreeColumn(
  lanes: readonly Lane[],
  maxColumns: number
): { column: number; clamped: boolean } {
  const forbidden = new Set<number>();
  for (const lane of lanes) forbidden.add(lane.column);
  for (let column = 0; column < maxColumns; column += 1) {
    if (!forbidden.has(column)) return { column, clamped: false };
  }
  return { column: Math.max(0, maxColumns - 1), clamped: true };
}

/**
 * Drop repeated shas, keeping the first occurrence.
 *
 * `git log` never repeats a commit, but a caller that concatenates two pages
 * across a concurrent write can, and a duplicate would desync every row index
 * after it. Deduping is cheaper than making every consumer defensive.
 */
export function dedupeCommits(commits: readonly GraphInputCommit[]): {
  commits: GraphInputCommit[];
  dropped: number;
} {
  const seen = new Set<string>();
  const out: GraphInputCommit[] = [];
  let dropped = 0;
  for (const c of commits) {
    if (seen.has(c.sha)) {
      dropped += 1;
      continue;
    }
    seen.add(c.sha);
    out.push(c);
  }
  return { commits: out, dropped };
}

/**
 * Lay out a commit list (newest first, `git log` order) onto rows × columns.
 *
 * Guarantees, all covered by `graph-layout.test.ts`:
 *   1. every commit gets exactly one row (its index) and one column;
 *   2. no edge's spanning column is occupied by another node on a row strictly
 *      between its endpoints — the no-crossing property the forbidden-column
 *      rule exists to produce;
 *   3. a parent missing from the list yields a `dangling` edge rather than a
 *      dropped one;
 *   4. `columns` never exceeds `maxColumns`.
 */
export function computeGraphLayout(
  input: readonly GraphInputCommit[],
  options: GraphLayoutOptions = {}
): GraphLayout {
  const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? DEFAULT_MAX_COLUMNS));
  const { commits, dropped } = dedupeCommits(input);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const passThrough: number[][] = [];
  const nodeBySha = new Map<string, GraphNode>();
  let lanes: Lane[] = [];
  let clamped = false;
  let maxColumnSeen = -1;

  for (let row = 0; row < commits.length; row += 1) {
    const commit = commits[row] as GraphInputCommit;

    // ── The forbidden set for this row, before we touch anything ────────────
    const lanesBefore = lanes;

    // Every pending edge whose parent is THIS commit. More than one is the
    // normal diamond/merge case; all of them terminate here.
    const incoming = lanesBefore.filter((lane) => lane.targetSha === commit.sha);

    let column: number;
    let nodeClamped = false;
    if (incoming.length > 0) {
      // Rejoin at the leftmost arriving lane so the mainline reabsorbs
      // side-branches rather than drifting right.
      column = incoming.reduce((min, lane) => (lane.column < min ? lane.column : min), incoming[0]!.column);
    } else {
      // A tip commit: nothing points at it yet. Lowest non-forbidden column.
      const alloc = lowestFreeColumn(lanesBefore, maxColumns);
      column = alloc.column;
      nodeClamped = alloc.clamped;
      if (alloc.clamped) clamped = true;
    }

    // Close the arriving lanes.
    const closed = new Set<Lane>(incoming);
    for (const lane of incoming) {
      edges.push({
        fromSha: lane.fromSha,
        fromRow: lane.fromRow,
        fromColumn: lane.fromColumn,
        toSha: commit.sha,
        toRow: row,
        toColumn: column,
        column: lane.column,
        kind: lane.kind,
        dangling: false,
      });
      if (lane.column > maxColumnSeen) maxColumnSeen = lane.column;
    }
    lanes = lanesBefore.filter((lane) => !closed.has(lane));

    // A lane that was pending before this row and is still pending after it
    // spans the row uninterrupted — that is precisely `passThrough`.
    const spanning = new Set<number>();
    for (const lane of lanes) spanning.add(lane.column);
    passThrough.push([...spanning].sort((a, b) => a - b));

    // ── Open this commit's outgoing edges ──────────────────────────────────
    if (commit.parents.length > 0) {
      // First parent keeps the column, so mainline history reads as a straight
      // line no matter how much merges churn around it.
      lanes.push({
        column,
        targetSha: commit.parents[0] as string,
        fromSha: commit.sha,
        fromRow: row,
        fromColumn: column,
        kind: 'parent',
      });
      for (let p = 1; p < commit.parents.length; p += 1) {
        const alloc = lowestFreeColumn(lanes, maxColumns);
        if (alloc.clamped) {
          clamped = true;
          nodeClamped = true;
        }
        lanes.push({
          column: alloc.column,
          targetSha: commit.parents[p] as string,
          fromSha: commit.sha,
          fromRow: row,
          fromColumn: column,
          kind: 'merge',
        });
      }
    }

    const node: GraphNode = {
      sha: commit.sha,
      row,
      column,
      parents: commit.parents,
      isMerge: commit.parents.length > 1,
      isRoot: commit.parents.length === 0,
      clamped: nodeClamped,
    };
    nodes.push(node);
    nodeBySha.set(commit.sha, node);
    if (column > maxColumnSeen) maxColumnSeen = column;
  }

  // Anything still pending points at a parent outside the loaded page.
  for (const lane of lanes) {
    edges.push({
      fromSha: lane.fromSha,
      fromRow: lane.fromRow,
      fromColumn: lane.fromColumn,
      toSha: null,
      toRow: commits.length,
      toColumn: lane.column,
      column: lane.column,
      kind: lane.kind,
      dangling: true,
    });
    if (lane.column > maxColumnSeen) maxColumnSeen = lane.column;
  }

  return {
    nodes,
    edges,
    columns: maxColumnSeen + 1,
    passThrough,
    nodeBySha,
    clamped,
    duplicatesDropped: dropped,
  };
}

/**
 * Render a layout as gitk-style ASCII. Used by `graph-layout.test.ts` to make
 * failures readable and by `tools/history-cli.ts` to eyeball a real repo's
 * layout against `git log --graph --oneline`.
 *
 * Glyphs: `*` commit · `M` merge commit · `|` a lane spanning the row ·
 * `/` a lane terminating here from a column to the right · `\` a merge lane
 * opening here to the right · `:` a lane running off the bottom of the page.
 */
export function layoutToAscii(
  layout: GraphLayout,
  labelFor: (node: GraphNode) => string = (n) => n.sha.slice(0, 7)
): string {
  const width = Math.max(1, layout.columns);
  const lines: string[] = [];

  const opensAt = new Map<number, number[]>();
  const closesAt = new Map<number, number[]>();
  const danglesFrom = new Map<number, number[]>();
  for (const edge of layout.edges) {
    if (edge.kind === 'merge') {
      const list = opensAt.get(edge.fromRow) ?? [];
      list.push(edge.column);
      opensAt.set(edge.fromRow, list);
    }
    if (edge.dangling) {
      const list = danglesFrom.get(edge.fromRow) ?? [];
      list.push(edge.column);
      danglesFrom.set(edge.fromRow, list);
    } else if (edge.column !== edge.toColumn) {
      const list = closesAt.get(edge.toRow) ?? [];
      list.push(edge.column);
      closesAt.set(edge.toRow, list);
    }
  }

  for (const node of layout.nodes) {
    const cells: string[] = new Array<string>(width).fill(' ');
    for (const column of layout.passThrough[node.row] ?? []) cells[column] = '|';
    for (const column of closesAt.get(node.row) ?? []) cells[column] = '/';
    for (const column of opensAt.get(node.row) ?? []) cells[column] = '\\';
    for (const column of danglesFrom.get(node.row) ?? []) {
      if (cells[column] === ' ') cells[column] = ':';
    }
    cells[node.column] = node.isMerge ? 'M' : '*';
    lines.push(`${cells.join(' ')}  ${labelFor(node)}`);
  }

  return lines.join('\n');
}
