// com.ikenga.studio · layout + per-pane-view state
//
// Separate from shared-state.ts on purpose: this is iframe chrome (which
// layout preset is active, which view each pane shows), not the four
// cross-pane values that publish on the iyke channel. Switching a pane's
// view or the layout preset never touches cellUid/playheadMs/hoverBeat/
// engineMode — that invariant is the whole point of keeping the stores apart.
//
// Persistence: the chosen layout is per-folder, mirroring the shell home
// page's layout persistence. The sink is `localStorage` keyed by project id
// (see lib/layout-persistence.ts for why that's the right sink under the
// shell's srcdoc delivery). `bindPersistence(projectId)` is called when a
// project opens (App.tsx) — it rehydrates the stored layout and arms the
// setters to persist on every subsequent change; `unbindPersistence()` stops
// persisting when the project closes.

import { create } from 'zustand';

import {
  DEFAULT_PANE_VIEWS,
  DEFAULT_RATIOS,
  LAYOUTS,
  type LayoutId,
  type PaneIndex,
  type ViewId,
} from './routes';
import { loadLayout, saveLayout } from './lib/layout-persistence';

/** Deep-clone the default ratio table so the store never mutates the module
 *  constant (arrays are held by reference otherwise). */
function freshRatios(): Record<LayoutId, number[]> {
  return {
    single: [...DEFAULT_RATIOS.single],
    vsplit: [...DEFAULT_RATIOS.vsplit],
    hsplit: [...DEFAULT_RATIOS.hsplit],
    tripane: [...DEFAULT_RATIOS.tripane],
  };
}

export interface LayoutStoreState {
  layout: LayoutId;
  /** View shown in each pane slot. Indices beyond the active layout's pane
   *  count are retained so switching layouts restores prior choices. */
  paneViews: Record<PaneIndex, ViewId>;
  /** Which pane currently has keyboard focus (for the 1–5 view-switcher
   *  shortcut + the V-split focus trap, commit 15). */
  focusedPane: PaneIndex;
  /** Per-preset divider ratios (draggable pane resizing). Each entry is the
   *  first-side fraction (0–1) of that preset's divider(s); see routes.ts
   *  DEFAULT_RATIOS for the index→divider mapping. Kept per preset so switching
   *  presets restores each one's last drag position. */
  ratios: Record<LayoutId, number[]>;
}

export interface LayoutStoreActions {
  setLayout: (layout: LayoutId) => void;
  setPaneView: (pane: PaneIndex, view: ViewId) => void;
  setFocusedPane: (pane: PaneIndex) => void;
  /** Move focus to the next/prev pane within the active layout (F6 / Ctrl+`,
   *  commit 15). Wraps. */
  cycleFocus: (dir: 1 | -1) => void;
  /** Set the ratio (first-side fraction, 0–1) of a divider in a preset. Callers
   *  clamp to the min-pane constraint before calling (the store just stores). */
  setRatio: (layout: LayoutId, divider: number, value: number) => void;
  /** Reset a divider to its preset default (double-click on the divider). */
  resetRatio: (layout: LayoutId, divider: number) => void;
  /** Bind persistence to an open project: rehydrate the stored layout +
   *  paneViews for `projectId`, then persist every subsequent change under it.
   *  Called from App.tsx when a project opens. */
  bindPersistence: (projectId: string) => void;
  /** Stop persisting (project closed / launcher re-entered). */
  unbindPersistence: () => void;
}

export type LayoutStore = LayoutStoreState & LayoutStoreActions;

const INITIAL: LayoutStoreState = {
  layout: 'vsplit',
  paneViews: { ...DEFAULT_PANE_VIEWS },
  focusedPane: 0,
  ratios: freshRatios(),
};

export const useLayoutStore = create<LayoutStore>((set, get) => {
  // Which project's layout the setters persist under. `null` until a project
  // opens (bindPersistence) — the launcher's pre-project chrome never persists.
  let boundProjectId: string | null = null;

  const persist = () => {
    if (!boundProjectId) return;
    const { layout, paneViews, ratios } = get();
    saveLayout(boundProjectId, { layout, paneViews, ratios });
  };

  return {
    ...INITIAL,

    setLayout: (layout) => {
      // Clamp focus into the new layout's pane range so a focusedPane=2 carried
      // over from tripane doesn't point at a non-existent pane in single/vsplit.
      const maxPane = (LAYOUTS[layout].panes - 1) as PaneIndex;
      set((s) => ({
        layout,
        focusedPane: Math.min(s.focusedPane, maxPane) as PaneIndex,
      }));
      persist();
    },

    setPaneView: (pane, view) => {
      set((s) => ({ paneViews: { ...s.paneViews, [pane]: view } }));
      persist();
    },

    setFocusedPane: (pane) => set({ focusedPane: pane }),

    cycleFocus: (dir) => {
      const { layout, focusedPane } = get();
      const count = LAYOUTS[layout].panes;
      const next = ((focusedPane + dir + count) % count) as PaneIndex;
      set({ focusedPane: next });
    },

    setRatio: (layout, divider, value) => {
      set((s) => {
        const current = s.ratios[layout];
        if (divider < 0 || divider >= current.length) return s;
        if (current[divider] === value) return s;
        const next = current.slice();
        next[divider] = value;
        return { ratios: { ...s.ratios, [layout]: next } };
      });
      persist();
    },

    resetRatio: (layout, divider) => {
      set((s) => {
        const current = s.ratios[layout];
        if (divider < 0 || divider >= current.length) return s;
        const next = current.slice();
        next[divider] = DEFAULT_RATIOS[layout][divider];
        return { ratios: { ...s.ratios, [layout]: next } };
      });
      persist();
    },

    bindPersistence: (projectId) => {
      boundProjectId = projectId;
      const restored = loadLayout(projectId);
      if (!restored) return;
      set((s) => {
        const layout = restored.layout;
        const maxPane = (LAYOUTS[layout].panes - 1) as PaneIndex;
        // Merge restored ratios over the defaults so a preset absent from
        // storage (or with an out-of-range length) keeps its 50/50 default.
        const ratios = freshRatios();
        if (restored.ratios) {
          for (const id of Object.keys(ratios) as LayoutId[]) {
            const saved = restored.ratios[id];
            if (saved && saved.length === ratios[id].length) ratios[id] = saved;
          }
        }
        return {
          layout,
          paneViews: { ...s.paneViews, ...restored.paneViews },
          focusedPane: Math.min(s.focusedPane, maxPane) as PaneIndex,
          ratios,
        };
      });
    },

    unbindPersistence: () => {
      boundProjectId = null;
    },
  };
});

// Stable selectors.
export const selectLayout      = (s: LayoutStoreState) => s.layout;
export const selectFocusedPane = (s: LayoutStoreState) => s.focusedPane;
