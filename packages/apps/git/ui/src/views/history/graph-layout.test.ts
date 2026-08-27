/**
 * com.ikenga.git · History — commit-graph layout tests (WP-08).
 *
 * Synthetic DAGs only. Every commit list here is written newest-first, the
 * order `git log` emits and the order `computeGraphLayout` assumes.
 *
 *   node --test --import=tsx 'ui/src/**\/*.test.ts'
 *
 * The last test is the one that matters: an invariant sweep asserting the
 * no-crossing property over a generated 400-commit DAG. The rest pin the
 * shapes a reader can check by eye.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeGraphLayout,
  dedupeCommits,
  layoutToAscii,
  type GraphInputCommit,
  type GraphLayout,
} from './graph-layout';

function c(sha: string, ...parents: string[]): GraphInputCommit {
  return { sha, parents };
}

function columnsBySha(layout: GraphLayout): Record<string, number> {
  const out: Record<string, number> = {};
  for (const node of layout.nodes) out[node.sha] = node.column;
  return out;
}

/**
 * The property the forbidden-column rule exists to produce: an edge spanning
 * rows (from, to) must not have any OTHER node sitting on its column at a row
 * strictly between its endpoints. If it did, the rail would draw a line
 * straight through an unrelated commit dot.
 */
function assertNoNodeUnderEdge(layout: GraphLayout): void {
  const nodeAt = new Map<string, string>();
  for (const node of layout.nodes) nodeAt.set(`${node.row}:${node.column}`, node.sha);
  for (const edge of layout.edges) {
    for (let row = edge.fromRow + 1; row < edge.toRow; row += 1) {
      const occupant = nodeAt.get(`${row}:${edge.column}`);
      assert.equal(
        occupant,
        undefined,
        `edge ${edge.fromSha.slice(0, 7)}→${edge.toSha?.slice(0, 7) ?? '(dangling)'} in column ${edge.column} passes through commit ${occupant} at row ${row}\n${layoutToAscii(layout)}`
      );
    }
  }
}

/** Every commit must appear exactly once, at its own index. */
function assertRowsAreIndices(layout: GraphLayout, expectedCount: number): void {
  assert.equal(layout.nodes.length, expectedCount);
  layout.nodes.forEach((node, i) => assert.equal(node.row, i, `row ${i} mislabelled`));
}

/** Every (child, parent) pair must produce exactly one edge. */
function assertEveryParentEdgeExists(
  layout: GraphLayout,
  commits: readonly GraphInputCommit[]
): void {
  const expected = commits.reduce((sum, commit) => sum + commit.parents.length, 0);
  assert.equal(layout.edges.length, expected, 'one edge per (child, parent) pair');
  for (const commit of commits) {
    for (const parent of commit.parents) {
      const found = layout.edges.filter(
        (e) => e.fromSha === commit.sha && (e.toSha === parent || (e.dangling && e.toSha === null))
      );
      assert.ok(found.length >= 1, `missing edge ${commit.sha} → ${parent}`);
    }
  }
}

describe('computeGraphLayout', () => {
  it('returns an empty layout for an empty list', () => {
    const layout = computeGraphLayout([]);
    assert.deepEqual(layout.nodes, []);
    assert.deepEqual(layout.edges, []);
    assert.equal(layout.columns, 0);
    assert.equal(layout.clamped, false);
  });

  it('lays a linear history out in a single column', () => {
    const commits = [c('e', 'd'), c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')];
    const layout = computeGraphLayout(commits);

    assertRowsAreIndices(layout, 5);
    assert.deepEqual(
      layout.nodes.map((n) => n.column),
      [0, 0, 0, 0, 0]
    );
    assert.equal(layout.columns, 1);
    assert.equal(layout.edges.length, 4);
    assert.ok(layout.edges.every((e) => !e.dangling && e.column === 0));
    // Nothing spans a row it doesn't terminate on, in a straight chain.
    assert.deepEqual(layout.passThrough, [[], [], [], [], []]);
    assertNoNodeUnderEdge(layout);
  });

  it('marks the root commit and opens no edge below it', () => {
    const layout = computeGraphLayout([c('b', 'a'), c('a')]);
    const root = layout.nodeBySha.get('a');
    assert.ok(root);
    assert.equal(root.isRoot, true);
    assert.equal(root.isMerge, false);
    assert.equal(layout.edges.filter((e) => e.fromSha === 'a').length, 0);
  });

  it('forks a merge to the right and rejoins at the leftmost arriving lane', () => {
    //   M ── merge of A (first parent) and B
    //   A
    //   B
    //   R
    const commits = [c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')];
    const layout = computeGraphLayout(commits);

    assertRowsAreIndices(layout, 4);
    assert.deepEqual(columnsBySha(layout), { M: 0, A: 0, B: 1, R: 0 });
    assert.equal(layout.columns, 2);
    assert.equal(layout.nodeBySha.get('M')?.isMerge, true);

    // Row 1 (A): B's lane is still pending in column 1, so it spans the row.
    // Row 2 (B): A→R is pending in column 0.
    // Row 3 (R): both lanes terminate here, nothing spans.
    assert.deepEqual(layout.passThrough, [[], [1], [0], []]);

    const mergeEdge = layout.edges.find((e) => e.fromSha === 'M' && e.toSha === 'B');
    assert.ok(mergeEdge);
    assert.equal(mergeEdge.kind, 'merge');
    assert.equal(mergeEdge.fromColumn, 0, 'the merge edge leaves the merge commit itself');
    assert.equal(mergeEdge.column, 1, 'and occupies the new lane while it spans');

    const firstParentEdge = layout.edges.find((e) => e.fromSha === 'M' && e.toSha === 'A');
    assert.equal(firstParentEdge?.kind, 'parent');
    assert.equal(firstParentEdge?.column, 0, 'first parent keeps the mainline straight');

    assertEveryParentEdgeExists(layout, commits);
    assertNoNodeUnderEdge(layout);
  });

  it('renders that diamond as readable ASCII', () => {
    const layout = computeGraphLayout([c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')]);
    assert.equal(
      layoutToAscii(layout, (n) => n.sha),
      ['M \\  M', '* |  A', '| *  B', '* /  R'].join('\n')
    );
  });

  it('frees a column when a branch ends and reuses it', () => {
    // Side branch S lives in column 1, dies at row 2; the later independent
    // tip T must be given column 1 back rather than a fresh column 2.
    const commits = [
      c('M', 'A', 'S'), //  0: merge, opens lane 1 for S
      c('A', 'R'), //       1: mainline
      c('S', 'R'), //       2: side branch terminates, column 1 freed
      c('R'), //            3: root of the first component
      c('T', 'U'), //       4: a second, disconnected tip
      c('U'), //            5
    ];
    const layout = computeGraphLayout(commits);
    const cols = columnsBySha(layout);
    assert.equal(cols.S, 1);
    assert.equal(cols.T, 0, 'column 0 is free again once R has no pending lanes');
    assert.equal(layout.columns, 2, 'no third column was ever needed');
    assertNoNodeUnderEdge(layout);
  });

  it('keeps a tip out of a column that is still occupied', () => {
    // P's lane to its far-below parent Z spans every row in between; the
    // unrelated tip Q must NOT be placed in that column.
    const commits = [c('P', 'Z'), c('Q', 'Y'), c('Y'), c('Z')];
    const layout = computeGraphLayout(commits);
    const cols = columnsBySha(layout);
    assert.equal(cols.P, 0);
    assert.equal(cols.Q, 1, 'column 0 is forbidden while P→Z spans the row');
    assertNoNodeUnderEdge(layout);
  });

  it('handles an octopus merge by opening one lane per extra parent', () => {
    const commits = [c('O', 'A', 'B', 'C'), c('A', 'R'), c('B', 'R'), c('C', 'R'), c('R')];
    const layout = computeGraphLayout(commits);
    assert.deepEqual(columnsBySha(layout), { O: 0, A: 0, B: 1, C: 2, R: 0 });
    assert.equal(layout.columns, 3);
    assert.equal(layout.edges.filter((e) => e.fromSha === 'O' && e.kind === 'merge').length, 2);
    assertEveryParentEdgeExists(layout, commits);
    assertNoNodeUnderEdge(layout);
  });

  it('dangles edges whose parent is off the bottom of the page', () => {
    // The pagination boundary: page one ends at `b`, whose parent `a` has not
    // been fetched yet.
    const commits = [c('c', 'b'), c('b', 'a')];
    const layout = computeGraphLayout(commits);
    const dangling = layout.edges.filter((e) => e.dangling);
    assert.equal(dangling.length, 1);
    assert.equal(dangling[0]?.fromSha, 'b');
    assert.equal(dangling[0]?.toSha, null);
    assert.equal(dangling[0]?.toRow, 2, 'one row past the last, so the rail runs off the bottom');
    assertNoNodeUnderEdge(layout);
  });

  it('resolves a previously dangling edge when the next page is appended', () => {
    const pageOne = [c('c', 'b'), c('b', 'a')];
    const both = [...pageOne, c('a')];
    assert.equal(computeGraphLayout(pageOne).edges.filter((e) => e.dangling).length, 1);
    assert.equal(computeGraphLayout(both).edges.filter((e) => e.dangling).length, 0);
  });

  it('treats a parent that never appears as dangling rather than dropping the edge', () => {
    // A grafted/shallow boundary: `b`'s parent is simply not in the DAG.
    const commits = [c('b', 'missing'), c('a')];
    const layout = computeGraphLayout(commits);
    assert.equal(layout.edges.length, 1);
    assert.equal(layout.edges[0]?.dangling, true);
  });

  it('clamps to maxColumns and says so', () => {
    const commits = [c('O', 'A', 'B', 'C', 'D'), c('A'), c('B'), c('C'), c('D')];
    const layout = computeGraphLayout(commits, { maxColumns: 2 });
    assert.equal(layout.clamped, true);
    assert.equal(layout.columns <= 2, true, 'columns never exceeds the cap');
    assert.ok(layout.edges.every((e) => e.column <= 1));
  });

  it('does not clamp when the cap is not reached', () => {
    const layout = computeGraphLayout([c('M', 'A', 'B'), c('A'), c('B')], { maxColumns: 8 });
    assert.equal(layout.clamped, false);
    assert.ok(layout.nodes.every((n) => !n.clamped));
  });

  it('drops duplicate shas so row indices stay in step', () => {
    const { commits, dropped } = dedupeCommits([c('b', 'a'), c('b', 'a'), c('a')]);
    assert.equal(dropped, 1);
    assert.deepEqual(
      commits.map((x) => x.sha),
      ['b', 'a']
    );
    const layout = computeGraphLayout([c('b', 'a'), c('b', 'a'), c('a')]);
    assert.equal(layout.duplicatesDropped, 1);
    assertRowsAreIndices(layout, 2);
  });

  it('holds the no-crossing invariant over a generated 400-commit DAG', () => {
    // A deterministic pseudo-random DAG: mostly linear with periodic forks and
    // merges, i.e. the shape a real feature-branch repo has. Seeded LCG so a
    // failure is reproducible from the printed ASCII.
    let seed = 0x5eed_1234;
    const rand = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
      return seed / 0x7fff_ffff;
    };

    const total = 400;
    // Built oldest-first (so a parent always exists before its child), then
    // reversed into git-log order, which is what the layout consumes.
    const commits: GraphInputCommit[] = [];
    const tips: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const sha = `c${String(i).padStart(4, '0')}`;
      const roll = rand();
      if (i === 0) {
        commits.push({ sha, parents: [] });
        tips.push(sha);
        continue;
      }
      if (tips.length > 1 && roll < 0.18) {
        // Merge: first parent is the newest tip, second is another live tip,
        // which stops being a tip.
        const other = 1 + Math.floor(rand() * (tips.length - 1));
        commits.push({ sha, parents: [tips[0] as string, tips[other] as string] });
        tips.splice(other, 1);
        tips[0] = sha;
        continue;
      }
      if (roll < 0.32 && tips.length < 6) {
        // Fork: a new branch off some live tip. The tip it forks from stays
        // live, so it will get a second child later — a genuine fork.
        const from = Math.floor(rand() * tips.length);
        commits.push({ sha, parents: [tips[from] as string] });
        tips.unshift(sha);
        continue;
      }
      commits.push({ sha, parents: [tips[0] as string] });
      tips[0] = sha;
    }

    const logOrder = [...commits].reverse();
    const layout = computeGraphLayout(logOrder);

    assertRowsAreIndices(layout, total);
    assertEveryParentEdgeExists(layout, logOrder);
    assertNoNodeUnderEdge(layout);
    assert.ok(layout.columns >= 2, 'the generated DAG should actually branch');
    assert.equal(layout.clamped, false, 'a realistic DAG stays under the default cap');
    assert.ok(
      layout.nodes.some((n) => n.isMerge),
      'the generated DAG should actually merge'
    );
  });
});
