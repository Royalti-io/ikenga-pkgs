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
import { loadLastProject } from './lib/project-persistence';
import { useProjectStore } from './project-store';

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

// ─── Cursor persistence (localStorage, keyed by project id) ──────────────
//
// review §5.3 "Persist + restore selection": cellUid/playheadMs/hoverBeat/
// engineMode live only in this destroyed-on-remount JS context today, so a
// pane switch or crash silently drops the user's place. Mirrored to
// localStorage per project id (`com.ikenga.studio:cursor:<id>`) and debounced
// so continuous playhead scrubbing doesn't hammer the write. Store creation
// happens before any project is open, so the ONLY project id available at
// that point is the last-opened one persisted by lib/project-persistence.ts
// (the same key the Launcher's auto-reopen reads) — hydration below reuses
// that key rather than inventing a second "current project" concept, and
// only ever applies a persisted blob keyed to that exact id, which is what
// keeps a stale/foreign project's cursor from leaking into a fresh open.

const CURSOR_KEY_PREFIX = 'com.ikenga.studio:cursor:';
const CURSOR_SAVE_DEBOUNCE_MS = 500;

function cursorStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__studio_cursor_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function loadCursor(projectId: string): SharedStoreState | null {
  const s = cursorStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(CURSOR_KEY_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudioPublishedState>;
    return {
      cellUid:    typeof parsed.cellUid === 'string' ? parsed.cellUid : null,
      playheadMs: typeof parsed.playheadMs === 'number' ? parsed.playheadMs : 0,
      hoverBeat:  typeof parsed.hoverBeat === 'string' ? parsed.hoverBeat : null,
      engineMode: parsed.engineMode === 'remotion' ? 'remotion' : 'hf',
    };
  } catch {
    return null;
  }
}

function saveCursor(projectId: string, cursor: StudioPublishedState): void {
  const s = cursorStorage();
  if (!s) return;
  try {
    s.setItem(CURSOR_KEY_PREFIX + projectId, JSON.stringify(cursor));
  } catch {
    // quota / opaque origin — degrade to no-persistence, same as
    // lib/project-persistence.ts.
  }
}

/** Resolve the store's initial values: defaults unless the last-opened
 *  project (the one the Launcher will try to auto-reopen) has a persisted
 *  cursor on file. Guards the stale-project case implicitly — the lookup is
 *  keyed by that exact project id, so a different project's leftover cursor
 *  is never a candidate. */
function hydrateInitial(): SharedStoreState {
  const last = loadLastProject();
  if (!last?.project_id) return INITIAL;
  return loadCursor(last.project_id) ?? INITIAL;
}

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
    ...hydrateInitial(),

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

// Debounced cursor persistence, keyed by the CURRENTLY open project (not the
// last-opened one hydrateInitial() reads — that distinction matters mid-
// session: once a project is open, its own id is authoritative). No project
// open means nothing to key the write to, so it's a no-op until one is.
let _cursorSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingCursorSave: { projectId: string; cursor: StudioPublishedState } | null = null;

function flushCursorSave(): void {
  if (_cursorSaveTimer) {
    clearTimeout(_cursorSaveTimer);
    _cursorSaveTimer = null;
  }
  if (_pendingCursorSave) {
    saveCursor(_pendingCursorSave.projectId, _pendingCursorSave.cursor);
    _pendingCursorSave = null;
  }
}

useSharedStore.subscribe(
  (state) => snapshot(state),
  (next) => {
    const projectId = useProjectStore.getState().project?.project_id;
    if (!projectId) return;
    _pendingCursorSave = { projectId, cursor: next };
    if (_cursorSaveTimer) clearTimeout(_cursorSaveTimer);
    _cursorSaveTimer = setTimeout(() => {
      _cursorSaveTimer = null;
      flushCursorSave();
    }, CURSOR_SAVE_DEBOUNCE_MS);
  },
  { equalityFn: (a, b) =>
      a.cellUid    === b.cellUid &&
      a.playheadMs === b.playheadMs &&
      a.hoverBeat  === b.hoverBeat &&
      a.engineMode === b.engineMode,
  },
);

// A project switch can land well inside the debounce window — flush the
// OUTGOING project's pending cursor first rather than losing it or (worse)
// writing it under the incoming project's id. useProjectStore has no
// subscribeWithSelector middleware, so this takes the plain full-state form
// rather than the (selector, listener) overload used above.
useProjectStore.subscribe((state, prevState) => {
  if (
    prevState.project?.project_id
    && prevState.project.project_id !== state.project?.project_id
  ) flushCursorSave();
});

// Best-effort crash/close safety net; debounce alone would drop the last
// ~500ms of cursor movement on a hard close.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushCursorSave);
  window.addEventListener('beforeunload', flushCursorSave);
}

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
