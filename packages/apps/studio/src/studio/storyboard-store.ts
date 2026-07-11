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

import { getMcpClient, storyboardApi } from './mcp-client';
import type { Beat, Cell } from './mcp-types';

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
  /** Clear on project close so the launcher/mocks take over again. */
  clear: () => void;
  /** Look up the display projection of one cell by uid (Cell view). */
  displayCell: (uid: string | null) => DisplayCell | null;
}

export type StoryboardStore = StoryboardStoreState & StoryboardStoreActions;

export const useStoryboardStore = create<StoryboardStore>((set, get) => ({
  projectId: null,
  cells: [],
  beats: [],
  source: 'empty',
  loading: false,
  error: null,

  hydrate: async (projectId) => {
    set({ projectId, loading: true, error: null });
    try {
      const client = await getMcpClient();
      const { beats, cells } = await storyboardApi.read(client, projectId);
      set({
        cells: cells ?? [],
        beats: beats ?? [],
        source: client.mode === 'real' ? 'real' : 'mock',
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  refetch: async () => {
    const { projectId } = get();
    if (!projectId) return;
    await get().hydrate(projectId);
  },

  clear: () => set({ projectId: null, cells: [], beats: [], source: 'empty', loading: false, error: null }),

  displayCell: (uid) => {
    if (!uid) return null;
    const cell = get().cells.find((c) => c.uid === uid);
    return cell ? toDisplayCell(cell) : null;
  },
}));

// ─── selectors ─────────────────────────────────────────────────────────

export const selectHydratedCells = (s: StoryboardStoreState) => s.cells;
export const selectStoryboardSource = (s: StoryboardStoreState) => s.source;
/** True when real cells are loaded — the signal views use to prefer hydrated
 *  data over their static mock fixture. */
export const selectHasRealCells = (s: StoryboardStoreState) =>
  s.source === 'real' && s.cells.length > 0;
