// com.ikenga.studio · storyboard hydration store
//
// Holds the cells/beats read from the open project's storyboard.json via the
// MCP `storyboard.read` tool, so the data-driven views (Canvas, Cell) render
// REAL cells "hydrated from disk" instead of the __mocks__/cells.ts fixture.
//
// EVENTS (Round-13 Finding): the shell can't relay pkg:// cells/changed events
// to the iframe, so we cannot react to on-disk edits push-style. Instead this
// store exposes `refetch()`, which the views call on focus + after their own
// mutations (storyboard.write_cell / set_approved) — a POLL-on-demand stand-in
// for the event stream. A future event relay would just call `refetch()` (or
// splice the changed_uids) from a subscription, with no call-site changes.
//
// `source` records where the current cells came from so views can decide
// whether to prefer these or their static mock: 'real' (a real MCP client
// returned them), 'mock' (the mock client), or 'empty' (nothing loaded yet).

import { create } from 'zustand';

import { getMcpClient, storyboardApi, renderApi } from './mcp-client';
import { foldRenderStatus } from './lib/composition-model';
import type { Beat, Cell, Project, RenderStatus, RenderRecord } from './mcp-types';

// ─── display projection ──────────────────────────────────────────────────
//
// The Canvas/Cell views were written against __mocks__/cells.ts `MockCell`
// ({ uid, beat, rung, approved, color, block_id?, progress? }). Schema `Cell`
// carries the same identity but names the beat `beat_id` and has no
// presentation color. `toDisplayCell` bridges the two so those views can take
// real cells with a one-line map instead of a rewrite.

import type { Rung } from './mcp-types';

export interface DisplayCell {
  uid: string;
  beat: string;
  rung: Rung;
  approved: boolean;
  color: 'amber' | 'rose' | 'emerald' | 'sky' | 'violet' | 'neutral';
  block_id?: string;
  progress?: number;
  /** The raw schema cell — Cell view reads content_path/renderer/etc. off it. */
  raw: Cell;
}

const PALETTE: DisplayCell['color'][] = ['amber', 'rose', 'emerald', 'sky', 'violet'];

/** Stable color from the beat id so the same beat always tints the same. */
function colorFor(beatId: string, rung: Rung): DisplayCell['color'] {
  if (rung !== '2_hifi') return 'neutral';
  let h = 0;
  for (let i = 0; i < beatId.length; i++) h = (h * 31 + beatId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function toDisplayCell(cell: Cell): DisplayCell {
  const beat = cell.beat_id || cell.label || cell.uid;
  return {
    uid: cell.uid,
    beat,
    rung: cell.rung,
    approved: cell.approved,
    color: colorFor(beat, cell.rung),
    block_id: cell.block_id ?? undefined,
    raw: cell,
  };
}

// ─── store ──────────────────────────────────────────────────────────────

export interface StoryboardStoreState {
  projectId: string | null;
  cells: Cell[];
  beats: Beat[];
  /** The full storyboard.json project doc from `storyboard.read` — carries the
   *  narration block + resolution + current_rung the thin OpenProjectSummary
   *  (project-store) omits. Composition builds its real timeline model + the
   *  narration/none treatment off this. */
  projectDoc: Project | null;
  /** Latest render status per cell uid (real mode) — the render.list poll
   *  folded via `foldRenderStatus`. Empty in mock/standalone (those views use
   *  their fixture's baked-in statuses). Drives the Composition clip treatment
   *  and the now-rendering beacon. */
  renderStatus: Record<string, RenderStatus>;
  /** The raw render.list records (latest poll). Composition reads these for the
   *  per-cell records table (engine / finished / output path) and to resolve a
   *  cell's done-render id for byte-based playback. */
  renderRecords: RenderRecord[];
  /** Wall-clock ms of the last successful render.list poll — drives the C-C
   *  "Synced Ns ago" freshness stamp. null until the first poll lands. */
  lastSyncedAt: number | null;
  /** Force fast-polling until this wall-clock ms even when nothing is currently
   *  queued/running yet — set right after an enqueue so a freshly-submitted
   *  render is picked up before it flips the status map. */
  activeUntil: number;
  source: 'real' | 'mock' | 'empty';
  loading: boolean;
  error: string | null;
}

export interface StoryboardStoreActions {
  /** Load the storyboard for a project through the MCP client. Records the
   *  client mode so views know whether these are real or mock cells. */
  hydrate: (projectId: string) => Promise<void>;
  /** Re-read the current project's storyboard (view focus / after a mutation). */
  refetch: () => Promise<void>;
  /** Re-read the render_queue via render.list and fold it into `renderStatus`
   *  (real mode only). The on-demand + interval poll stand-in for the
   *  render/progress events the shell can't relay to the iframe (Round-13
   *  Finding); App.tsx polls this while a real project is open. No-op in
   *  mock/standalone mode. */
  refreshRenders: () => Promise<void>;
  /** Bump the fast-poll window (call right after enqueuing a render/export) so
   *  the adaptive poll re-arms even before the status map shows work in-flight. */
  bumpActivePoll: (ms?: number) => void;
  /** Clear on project close so the launcher/mocks take over again. */
  clear: () => void;
  /** Look up the display projection of one cell by uid (Cell view). */
  displayCell: (uid: string | null) => DisplayCell | null;
}

// ─── poll-tick reference stability (review §2.2/2.6) ─────────────────────
//
// `foldRenderStatus` (and the raw render.list rows behind it) return a fresh
// object/array every ~2s poll tick even when nothing changed. Cell/Canvas/
// Composition/NowRenderingBeacon all subscribe to `renderStatus` (and the
// first three to `renderRecords`) by reference via zustand's default
// Object.is selector equality, so a same-value-but-new-reference tick still
// re-renders all four. Reusing the prior reference when the values are
// unchanged fixes every consumer at the store instead of requiring a
// `useShallow` at each call site.

function statusMapEqual(a: Record<string, RenderStatus>, b: Record<string, RenderStatus>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) if (a[k] !== b[k]) return false;
  return true;
}

/** Records are small, JSON-serializable, and `.passthrough()`-shaped (nested
 *  `output`/`preview`/`metadata`) — a structural stringify compare is cheaper
 *  to get right than a hand-rolled deep-equal and still cheap at render.list's
 *  scale. */
function recordsEqual(a: RenderRecord[], b: RenderRecord[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export type StoryboardStore = StoryboardStoreState & StoryboardStoreActions;

export const useStoryboardStore = create<StoryboardStore>((set, get) => ({
  projectId: null,
  cells: [],
  beats: [],
  projectDoc: null,
  renderStatus: {},
  renderRecords: [],
  lastSyncedAt: null,
  activeUntil: 0,
  source: 'empty',
  loading: false,
  error: null,

  hydrate: async (projectId) => {
    set({ projectId, loading: true, error: null });
    try {
      const client = await getMcpClient();
      const { project, beats, cells } = await storyboardApi.read(client, projectId);
      set({
        cells: cells ?? [],
        beats: beats ?? [],
        projectDoc: project ?? null,
        source: client.mode === 'real' ? 'real' : 'mock',
        loading: false,
      });
      // Seed render status right after cells load so the timeline paints its
      // real ✓/◐/○ treatment on first render (App.tsx keeps it fresh after).
      if (client.mode === 'real') void get().refreshRenders();
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  refetch: async () => {
    const { projectId } = get();
    if (!projectId) return;
    await get().hydrate(projectId);
  },

  refreshRenders: async () => {
    const { projectId, source, renderStatus: prevStatus, renderRecords: prevRecords } = get();
    if (!projectId || source !== 'real') return;
    try {
      const client = await getMcpClient();
      if (client.mode !== 'real') return;
      const { records } = await renderApi.list(client);
      const nextRecords = records ?? [];
      const nextStatus = foldRenderStatus(nextRecords);
      set({
        renderStatus: statusMapEqual(prevStatus, nextStatus) ? prevStatus : nextStatus,
        renderRecords: recordsEqual(prevRecords, nextRecords) ? prevRecords : nextRecords,
        lastSyncedAt: Date.now(),
      });
    } catch {
      // render.list unavailable / transient — keep the prior statuses rather
      // than blanking the timeline treatment.
    }
  },

  bumpActivePoll: (ms = 8_000) => set({ activeUntil: Date.now() + ms }),

  clear: () => set({ projectId: null, cells: [], beats: [], projectDoc: null, renderStatus: {}, renderRecords: [], lastSyncedAt: null, activeUntil: 0, source: 'empty', loading: false, error: null }),

  displayCell: (uid) => {
    if (!uid) return null;
    const cell = get().cells.find((c) => c.uid === uid);
    return cell ? toDisplayCell(cell) : null;
  },
}));

// ─── selectors ─────────────────────────────────────────────────────────

export const selectHydratedCells = (s: StoryboardStoreState) => s.cells;
export const selectHydratedProject = (s: StoryboardStoreState) => s.projectDoc;
export const selectRenderStatus = (s: StoryboardStoreState) => s.renderStatus;
export const selectRenderRecords = (s: StoryboardStoreState) => s.renderRecords;
export const selectLastSyncedAt = (s: StoryboardStoreState) => s.lastSyncedAt;
export const selectStoryboardSource = (s: StoryboardStoreState) => s.source;
/** True while any cell is queued or running — the adaptive poll's fast-mode gate. */
export const selectHasActiveRenders = (s: StoryboardStoreState) =>
  Object.values(s.renderStatus).some((v) => v === 'queued' || v === 'running');
/** True when real cells are loaded — the signal views use to prefer hydrated
 *  data over their static mock fixture. */
export const selectHasRealCells = (s: StoryboardStoreState) =>
  s.source === 'real' && s.cells.length > 0;
