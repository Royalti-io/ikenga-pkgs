// com.ikenga.studio · real composition timeline model
//
// Builds the Composition view's timeline model from a HYDRATED project (the
// cells + storyboard.json doc read via storyboard.read) so real mode renders
// REAL clips instead of the __mocks__/composition.ts fixture. This is the
// Composition-side twin of storyboard-store's `toDisplayCell` (which does the
// same schema→presentation bridge for Canvas/Cell) — one pure builder shared by
// the Composition view, the NowRenderingBeacon, and Canvas's scrub cross-link so
// all three agree on the same [start,start+duration) windows and clip identity.
//
// Presentation-only fields (beat accent, the mock's synthetic waveform) are NOT
// on the schema — same rule as __mocks__/cells.ts / composition.ts. Accents come
// from the design's --beat-accent-* set (contract §5), cycled per distinct beat
// so real beat ids (which differ from the mock's hook/problem/…) still spread
// left→right. Render status per clip comes from the render.list poll folded into
// storyboard-store (contract §6 enum — no 'idle'); a cell with no render record
// yet stays `undefined` = the UI-local "pending" treatment.
//
// Time math stays in lib/time.ts (resume-contract §3): this module only sums
// durations for a contiguous rail — it never re-implements fmt()/frame math.

import type { Cell, RenderStatus, AspectRatio, Rung, NarrationBlock, RenderRecord } from '../mcp-types';
import { DEFAULT_RESOLUTION } from '../mcp-types';
import type {
  TimelineClip,
  BeatAccent,
  TransitionKind,
  MockNarrationBlock,
} from '../__mocks__/composition';

/** Composition-level metadata for the header + engine-tabs row + render/export
 *  rung. Real values come off the storyboard.json project doc; the mock supplies
 *  its own COMPOSITION_META in standalone mode. */
export interface CompositionMeta {
  name: string;
  aspect: AspectRatio;
  resolution: { w: number; h: number };
  rung: Rung;
}

/** The whole data surface the Composition view (and beacon / Canvas cross-link)
 *  consume. `narration: null` is the real "no narration yet" signal that drives
 *  the empty/none waveform treatment — never mock words over real cells. */
export interface TimelineModel {
  clips: TimelineClip[];
  totalMs: number;
  meta: CompositionMeta;
  narration: MockNarrationBlock | null;
}

// The 6 beat accents from the studio-editor layer's --beat-accent-* set
// (contract §5). Cycled per distinct beat in first-seen order — same spread
// strategy Canvas uses for its columns, so a beat always tints one colour.
export const BEAT_ACCENTS: BeatAccent[] = ['amber', 'rose', 'emerald', 'sky', 'violet', 'fuchsia'];

const TRANSITION_KINDS: TransitionKind[] = ['cut', 'fade', 'smash-cut', 'j-cut', 'l-cut'];

/** Sensible default when a cell carries neither duration_ms nor a time span. */
const DEFAULT_CLIP_MS = 4_000;

/** Cell → clip duration. Prefer the explicit duration_ms; fall back to the
 *  time-bounds span (seconds → ms); else a sane default so the rail never
 *  collapses a clip to zero width. */
function clipDurationMs(cell: Cell): number {
  if (typeof cell.duration_ms === 'number' && cell.duration_ms > 0) return cell.duration_ms;
  const start = cell.time?.start ?? 0;
  const end = cell.time?.end ?? 0;
  const span = Math.round((end - start) * 1000);
  if (span > 0) return span;
  return DEFAULT_CLIP_MS;
}

/** Out-transition for a clip, if the cell's open metadata bag carries a known
 *  one (unknown/absent → a plain cut, i.e. no marker). Transition is a
 *  ScriptBeat concept, not a first-class Cell field, so this is best-effort. */
function readTransition(cell: Cell): TransitionKind | undefined {
  const raw = (cell.metadata as Record<string, unknown> | undefined)?.transition;
  if (typeof raw === 'string' && (TRANSITION_KINDS as string[]).includes(raw)) {
    return raw as TransitionKind;
  }
  return undefined;
}

/** Numeric current_rung (0|1|2) → the Rung enum; default hi-fi (the composition
 *  is the finished cut). */
function numToRung(n: number | undefined): Rung {
  if (n === 0) return '0_beat_sheet';
  if (n === 1) return '1_lofi';
  return '2_hifi';
}

/** Schema NarrationBlock → the mock-shaped block the Composition JSX renders.
 *  Structurally compatible; we normalise `audio` to `{ uri }` and default the
 *  scalar fields. */
function toMockNarration(n: NarrationBlock): MockNarrationBlock {
  return {
    audio: { uri: n.audio?.uri ?? '' },
    words: n.words ?? [],
    duration_ms: n.duration_ms ?? 0,
    generated_at: n.generated_at ?? '',
  };
}

/** Minimal projection of the fields the model reads off the hydrated project
 *  doc — accepts the full schema `Project` (storyboard.json) with everything
 *  optional so a partial summary is tolerated too. */
export interface TimelineProjectLike {
  title?: string;
  slug?: string;
  name?: string;
  aspect_ratio?: AspectRatio;
  resolution?: { w: number; h: number };
  narration?: NarrationBlock | null;
  current_rung?: number;
}

/**
 * Build the real Composition timeline model from hydrated cells + the project
 * doc + the current render-status map. Cells lay out in array order on a
 * contiguous rail (start_ms = running sum of prior durations). One clip per
 * cell — the schema carries no separate composition timeline, the cell order IS
 * the cut order.
 */
export function buildTimelineModel(
  cells: Cell[],
  project: TimelineProjectLike | null,
  renderStatus: Record<string, RenderStatus | undefined>,
): TimelineModel {
  const accentByBeat = new Map<string, BeatAccent>();
  let accentIdx = 0;
  let cursor = 0;

  const clips: TimelineClip[] = cells.map((cell) => {
    const beat = cell.beat_id || cell.label || cell.uid;
    let accent = accentByBeat.get(beat);
    if (!accent) {
      accent = BEAT_ACCENTS[accentIdx % BEAT_ACCENTS.length];
      accentByBeat.set(beat, accent);
      accentIdx += 1;
    }
    const duration_ms = clipDurationMs(cell);
    const start_ms = cursor;
    cursor += duration_ms;
    const transition = readTransition(cell);
    const status = renderStatus[cell.uid];
    return {
      uid: cell.uid,
      beat,
      accent,
      start_ms,
      duration_ms,
      ...(transition ? { transition } : {}),
      ...(status ? { status } : {}),
    };
  });

  const totalMs = cursor > 0 ? cursor : DEFAULT_CLIP_MS;
  const aspect: AspectRatio = project?.aspect_ratio ?? '16:9';
  const resolution = project?.resolution ?? DEFAULT_RESOLUTION[aspect];
  const narration = project?.narration ? toMockNarration(project.narration) : null;

  return {
    clips,
    totalMs,
    meta: {
      name: project?.title || project?.slug || project?.name || 'composition',
      aspect,
      resolution,
      rung: numToRung(project?.current_rung),
    },
    narration,
  };
}

/** Clip active at a given playhead position, or null in a transition gap.
 *  The real-model twin of the mock's `clipAtMs` — takes the model's clips so
 *  every consumer scrubs against the same windows. */
export function clipAt(clips: TimelineClip[], ms: number): TimelineClip | null {
  return clips.find((c) => ms >= c.start_ms && ms < c.start_ms + c.duration_ms) ?? null;
}

/**
 * Fold a render.list result into the latest status per cell uid. Records may be
 * multiple per cell (one row per render attempt) and the list order is not a
 * guaranteed recency sort, so an ACTIVE status (running/queued) always wins over
 * a terminal one for the same cell, and among same-tier records the later one in
 * list order wins. This keeps a freshly-enqueued re-render showing "running"
 * even while an older "done" row for the cell is still present.
 */
export function foldRenderStatus(records: RenderRecord[]): Record<string, RenderStatus> {
  const ACTIVE = new Set<RenderStatus>(['running', 'queued']);
  const out: Record<string, RenderStatus> = {};
  for (const r of records) {
    if (!r || typeof r.cell_uid !== 'string' || !r.cell_uid) continue;
    const prev = out[r.cell_uid];
    if (prev && ACTIVE.has(prev) && !ACTIVE.has(r.status)) continue;
    out[r.cell_uid] = r.status;
  }
  return out;
}
