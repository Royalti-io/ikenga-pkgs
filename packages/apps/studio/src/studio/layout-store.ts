// com.ikenga.studio · layout + per-pane-view state
//
// Separate from shared-state.ts on purpose: this is iframe chrome (which
// layout preset is active, which view each pane shows), not the four
// cross-pane values that publish on the iyke channel. Switching a pane's
// view or the layout preset never touches cellUid/playheadMs/hoverBeat/
// engineMode — that invariant is the whole point of keeping the stores apart.
//
// Persistence: the chosen layout is per-folder, mirroring the shell home
// page's layout persistence. The real persistence sink is the host's
// `art.state` / pkg settings (wired when the launcher opens a project,
// commit 11); until then the store is in-memory and resets on reload. The
// persist hook is stubbed here so commit 11 only has to fill in the I/O.

import { create } from 'zustand';

import {
  DEFAULT_PANE_VIEWS,
  LAYOUTS,
  type LayoutId,
  type PaneIndex,
  type ViewId,
} from './routes';

export interface LayoutStoreState {
  layout: LayoutId;
  /** View shown in each pane slot. Indices beyond the active layout's pane
   *  count are retained so switching layouts restores prior choices. */
  paneViews: Record<PaneIndex, ViewId>;
  /** Which pane currently has keyboard focus (for the 1–5 view-switcher
   *  shortcut + the V-split focus trap, commit 15). */
  focusedPane: PaneIndex;
}

export interface LayoutStoreActions {
  setLayout: (layout: LayoutId) => void;
  setPaneView: (pane: PaneIndex, view: ViewId) => void;
  setFocusedPane: (pane: PaneIndex) => void;
  /** Move focus to the next/prev pane within the active layout (F6 / Ctrl+`,
   *  commit 15). Wraps. */
  cycleFocus: (dir: 1 | -1) => void;
}

export type LayoutStore = LayoutStoreState & LayoutStoreActions;

const INITIAL: LayoutStoreState = {
  layout: 'vsplit',
  paneViews: { ...DEFAULT_PANE_VIEWS },
  focusedPane: 0,
};

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  ...INITIAL,

  setLayout: (layout) => {
    // Clamp focus into the new layout's pane range so a focusedPane=2 carried
    // over from tripane doesn't point at a non-existent pane in single/vsplit.
    const maxPane = (LAYOUTS[layout].panes - 1) as PaneIndex;
    set((s) => ({
      layout,
      focusedPane: Math.min(s.focusedPane, maxPane) as PaneIndex,
    }));
  },

  setPaneView: (pane, view) =>
    set((s) => ({ paneViews: { ...s.paneViews, [pane]: view } })),

  setFocusedPane: (pane) => set({ focusedPane: pane }),

  cycleFocus: (dir) => {
    const { layout, focusedPane } = get();
    const count = LAYOUTS[layout].panes;
    const next = ((focusedPane + dir + count) % count) as PaneIndex;
    set({ focusedPane: next });
  },
}));

// Stable selectors.
export const selectLayout      = (s: LayoutStoreState) => s.layout;
export const selectFocusedPane = (s: LayoutStoreState) => s.focusedPane;
