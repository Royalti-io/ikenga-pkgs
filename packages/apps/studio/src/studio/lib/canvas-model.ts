// com.ikenga.studio · node-canvas geometry + stage derivation (Plan 25)
//
// Pure functions only, so the load-bearing decisions (D-25-1 stage membership,
// D-25-5 lane semantics) are headless-testable without mounting React or the
// pan/zoom primitive.

import type { Placement } from '@ikenga/contract/canvas';
import type { Cell, RenderStatus } from '../mcp-types';

// ─── the pipeline (Plan 25 "node model" table) ───────────────────────────
//
// The plan's fixed pipeline is "~6: script → breakdown → anchors → generate →
// render → export". WP-28 shipped five ending in a `Resolve` stage; that was
// drift, not a decision (G-76 #9). Resolve is one EXPORT TARGET among several
// (Plan 24's `export.davinci_timeline` sits beside `export.compose`), so it is
// a property of the export stage rather than a stage of its own. Back to six.

export type StageId = 'script' | 'breakdown' | 'anchors' | 'generate' | 'render' | 'export';

export interface StageDef {
  id: StageId;
  title: string;
}

export const PIPELINE_STAGES: StageDef[] = [
  { id: 'script', title: 'Script' },
  { id: 'breakdown', title: 'Breakdown' },
  { id: 'anchors', title: 'Anchors' },
  { id: 'generate', title: 'Generate' },
  { id: 'render', title: 'Render' },
  { id: 'export', title: 'Export' },
];

export const stageNodeId = (id: StageId): string => `stage-${id}`;

/**
 * D-25-1 — which pipeline stage a shot is currently IN. Membership, not
 * containment: the answer is rendered as an edge plus a chip on the shot, and a
 * shot passes through every stage over its life, so nothing here owns anything.
 *
 * Every branch reads a fact already on disk or already in the render queue. No
 * branch guesses:
 *   • a shot with nothing authored yet is still being broken down;
 *   • a shot whose prompt names anchors it doesn't have is at the anchors step;
 *   • queued/running is generation in flight;
 *   • a done render has rendered;
 *   • `approved` on top of a done render is what export composes from.
 * `failed`/`cancelled` deliberately report `generate` — that is where the work
 * stalled, and the stage node's own warning affordance is what flags it.
 */
export function deriveShotStage(cell: Cell, status: RenderStatus | undefined): StageId {
  if (status === 'done') return cell.approved ? 'export' : 'render';
  const hasDoneRender = (cell.renders ?? []).some((r) => r.status === 'done');
  if (hasDoneRender) return cell.approved ? 'export' : 'render';
  if (status === 'queued' || status === 'running') return 'generate';
  const authored = Boolean(cell.prompt?.trim() || cell.action?.trim() || cell.intent?.trim());
  if (!authored) return 'breakdown';
  return 'generate';
}

/** Counts per stage plus the failed set, for the stage-node rollup. D-25-4 is
 *  still open with the founder; this implements only its uncontroversial half —
 *  counts are primary, and a failed member promotes a warning WITHOUT changing
 *  the count (never worst-wins, which reads as alarming on a healthy board). */
export interface StageRollup {
  counts: Record<StageId, number>;
  failed: Record<StageId, number>;
}

export function rollupStages(
  cells: Cell[],
  statusOf: (uid: string) => RenderStatus | undefined,
): StageRollup {
  const counts = {} as Record<StageId, number>;
  const failed = {} as Record<StageId, number>;
  for (const s of PIPELINE_STAGES) {
    counts[s.id] = 0;
    failed[s.id] = 0;
  }
  for (const c of cells) {
    const status = statusOf(c.uid);
    const stage = deriveShotStage(c, status);
    counts[stage] += 1;
    if (status === 'failed') failed[stage] += 1;
  }
  return { counts, failed };
}

// ─── the sequence lane (D-25-5) ──────────────────────────────────────────
//
// "A shot's default placement is DERIVED, not authored: lane position = its
// index." Everything below exists so that stays true after the user drags
// something else: derived slots are recomputed from `Cell.index` on every
// render and are never written into `.studio/canvas.json`.

export const GRID_SNAP = 24;
export const LANE_Y = 320;
export const LANE_X0 = 40;
export const LANE_STEP = 220;
export const LANE_NODE_W = 200;
export const LANE_NODE_H = 220;
/** Collapsed-to-a-strip height (D-25-5's "recovers the Rail's compactness"). */
export const LANE_STRIP_H = 44;
/** Vertical tolerance around the lane: a drop inside this band is a lane
 *  reorder; anything outside it is free placement and stays non-semantic. */
export const LANE_BAND = 90;

export function laneSlot(index: number, laneCollapsed: boolean): Placement {
  return {
    x: LANE_X0 + index * LANE_STEP,
    y: LANE_Y,
    w: LANE_NODE_W,
    h: laneCollapsed ? LANE_STRIP_H : LANE_NODE_H,
  };
}

/** Is this placement sitting in the lane (i.e. did the user drop it back into
 *  the timeline rather than parking it somewhere)? */
export function inLaneBand(p: Placement | undefined): boolean {
  if (!p) return false;
  return Math.abs(p.y - LANE_Y) <= LANE_BAND;
}

export function placementsEqual(a: Placement | undefined, b: Placement | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Keep only what the user really AUTHORED. Any key whose placement is exactly
 * its derived default is dropped, so a shot resting at its lane slot has no
 * persisted position and keeps tracking `Cell.index` when an agent reorders the
 * board. Without this, the first drag anywhere on the canvas would freeze every
 * other node at wherever the lane happened to put it that render — the "lane
 * position is derived, not authored" half of D-25-5, silently lost.
 */
export function stripDerived(
  layout: Record<string, Placement>,
  derived: Record<string, Placement>,
): Record<string, Placement> {
  const authored: Record<string, Placement> = {};
  for (const [id, p] of Object.entries(layout)) {
    if (placementsEqual(p, derived[id])) continue;
    authored[id] = p;
  }
  return authored;
}

/**
 * The order the lane currently READS as, left to right — the array
 * `storyboard.reorder_cells` is handed after an in-lane drop.
 *
 * Only shots sitting inside the lane band participate in the sort; a shot the
 * user broke out keeps its existing ordinal and is spliced back at that
 * position, because breaking a shot out "changes nothing about the film".
 * Ties (two shots at the same x, which grid-snap makes reachable) fall back to
 * the incoming order so the result is deterministic.
 */
export function laneOrderFrom(
  shots: Array<{ uid: string; index: number }>,
  placementOf: (uid: string) => Placement | undefined,
): string[] {
  const inLane: Array<{ uid: string; x: number; seq: number }> = [];
  const outOfLane: Array<{ uid: string; index: number }> = [];

  shots.forEach((s, seq) => {
    const p = placementOf(s.uid);
    if (inLaneBand(p)) inLane.push({ uid: s.uid, x: p!.x, seq });
    else outOfLane.push({ uid: s.uid, index: s.index });
  });

  inLane.sort((a, b) => a.x - b.x || a.seq - b.seq);
  const order = inLane.map((s) => s.uid);

  // Splice the parked shots back at their own ordinals, lowest first, so their
  // index survives the round trip.
  outOfLane
    .sort((a, b) => a.index - b.index)
    .forEach((s) => {
      const at = Math.min(Math.max(s.index, 0), order.length);
      order.splice(at, 0, s.uid);
    });

  return order;
}

/** Did the two orders actually differ? A drag that lands a shot back in its own
 *  slot must not write `Cell.index` at all. */
export function orderChanged(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return true;
  return false;
}
