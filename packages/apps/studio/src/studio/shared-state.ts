// com.ikenga.studio · shared-state store
//
// The single source of truth across all five sub-views (Launcher, Canvas,
// Cell, Composition, Script, ArchetypeBuilder). The store carries exactly
// the four values that are published on the iyke channel — anything that's
// not in this snapshot is local to a view, not "shared state".
//
// Every setter publishes the full {cellUid, playheadMs, hoverBeat, engineMode}
// snapshot via bridge.publishStudioState as a synchronous side-effect. The
// canonical key on the iyke channel is 'studio'; the WP-07 plan §"Shared-
// state store (contract recap)" is the freeze line — adding a fifth value
// is a contract change that needs an explicit follow-up.
//
// `engineMode = 'remotion'` is type-permitted so the composition toggle UI
// (commit 8) can render the radio without an extra cast, but the value is
// locked behind P2: the renderer adapter that consumes it (WP-05) won't
// land until then, and the manifest's engine slot is pinned to HF for P1.
// See 09-orchestration.md §"Engine modes" for the gate.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { publishStudioState, type StudioPublishedState } from './bridge';

// ─── Public shape ────────────────────────────────────────────────────────

export type EngineMode = 'hf' | 'remotion';

/** The state that crosses pane boundaries. Identical shape to
 *  StudioPublishedState from bridge.ts — re-exporting from here lets views
 *  import the store + the type from one place. */
export interface SharedStoreState {
  cellUid:    string | null;
  playheadMs: number;
  hoverBeat:  string | null;
  engineMode: EngineMode;
}

/** Setters live on the same store object — Zustand convention. Each writes
 *  the new value and then publishes the full snapshot to iyke. */
export interface SharedStoreActions {
  setCellUid:    (uid: string | null) => void;
  setPlayheadMs: (ms: number) => void;
  setHoverBeat:  (id: string | null) => void;
  setEngineMode: (mode: EngineMode) => void;

  /** Reset to empty-project defaults. Used by the launcher when closing the
   *  current project and re-entering the archetype gallery. */
  reset: () => void;
}

export type SharedStore = SharedStoreState & SharedStoreActions;

// ─── Defaults ────────────────────────────────────────────────────────────

const INITIAL: SharedStoreState = {
  cellUid:    null,
  playheadMs: 0,
  hoverBeat:  null,
  engineMode: 'hf',
};

// ─── Side-effect: publish on every change ────────────────────────────────
//
// Done as middleware on top of subscribeWithSelector so the publish fires
// once per resolved state change (including the post-set transition) rather
// than once per setter call — which matters for `reset()` (one publish, not
// four). The subscribeWithSelector middleware also lets future commits
// (cross-linking in commit 12) subscribe to specific slices without
// re-rendering everything.

function snapshot(state: SharedStoreState): StudioPublishedState {
  return {
    cellUid:    state.cellUid,
    playheadMs: state.playheadMs,
    hoverBeat:  state.hoverBeat,
    engineMode: state.engineMode,
  };
}

// ─── Store ───────────────────────────────────────────────────────────────

export const useSharedStore = create<SharedStore>()(
  subscribeWithSelector((set) => ({
    ...INITIAL,

    setCellUid: (uid) => set({ cellUid: uid }),
    setPlayheadMs: (ms) => set({ playheadMs: ms }),
    setHoverBeat: (id) => set({ hoverBeat: id }),
    setEngineMode: (mode) => set({ engineMode: mode }),

    reset: () => set({ ...INITIAL }),
  })),
);

// Wire the iyke publish as a side-effect outside the setter bodies so it
// always reflects the resolved state (after Zustand's merge), and so a
// future setter that goes through `set((s) => ...)` doesn't need to
// remember to publish.
useSharedStore.subscribe(
  (state) => snapshot(state),
  (next, prev) => {
    if (
      next.cellUid    === prev.cellUid &&
      next.playheadMs === prev.playheadMs &&
      next.hoverBeat  === prev.hoverBeat &&
      next.engineMode === prev.engineMode
    ) return;
    publishStudioState(next);
  },
  { equalityFn: (a, b) =>
      a.cellUid    === b.cellUid &&
      a.playheadMs === b.playheadMs &&
      a.hoverBeat  === b.hoverBeat &&
      a.engineMode === b.engineMode,
  },
);

// Publish the initial snapshot once on module load so `iyke iframe-state
// <pane>` returns a defined value even before the user has interacted.
// Standalone-dev (no parent) makes this a no-op (see bridge.postIyke).
publishStudioState(snapshot(useSharedStore.getState()));

// ─── Convenience selectors ───────────────────────────────────────────────
//
// Stable references so they don't trigger re-renders when used with
// useSharedStore(selector). Add view-specific selectors next to the views
// that need them; only put selectors here when they're shared across two or
// more views.

export const selectCellUid    = (s: SharedStoreState) => s.cellUid;
export const selectPlayheadMs = (s: SharedStoreState) => s.playheadMs;
export const selectHoverBeat  = (s: SharedStoreState) => s.hoverBeat;
export const selectEngineMode = (s: SharedStoreState) => s.engineMode;

// `activeCellAtPlayhead` is deferred — it needs the loaded Project to walk
// cells against `playheadMs`. WP-07 commit 4 (MCP mock) introduces the
// Project slot via storyboard.* calls, and commit 8 (Composition timeline)
// is the first consumer that needs the selector. Stub kept here as a
// reminder so the contract recap in 10-wp07-iframe.md stays accurate.
//
// export function selectActiveCellAtPlayhead(...): Cell | null {
//   return null;
// }
