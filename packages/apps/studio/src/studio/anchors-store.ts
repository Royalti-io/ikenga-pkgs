// com.ikenga.studio · anchors hydration store
//
// Mirrors storyboard-store.ts's idiom for `anchor.list` (review §2.4/§2.5):
// Cell, Canvas, Handoff, Breakdown, Ledger and CastWorld each independently
// re-fetched the same project-scoped anchor list — a multi-pane layout fired
// concurrent duplicates, and every pane remount re-paid the round trip. This
// store hydrates once per project: `ensure()` is the mount-effect entry point
// and is a no-op once this project's anchors are loaded or already in
// flight. Because zustand's `set` is synchronous, a second view's `ensure()`
// call in the same commit already sees `loading: true` and skips its own
// fetch — no separate module-scope in-flight promise is needed.
//
// `refresh()` is for the mutation sites (CastWorld's generate / regenerate /
// lock, which have no anchor.update RPC and go through delete→create) so
// every consumer of the store sees the write, not just the pane that made it.
//
// `clear()` exists for API symmetry with storyboard-store.clear() (a future
// project-close hook in App.tsx); no view here calls it — `ensure()`'s
// projectId check already re-hydrates on project switch without one.

import { create } from 'zustand';

import { getMcpClient, anchorApi } from './mcp-client';
import type { Anchor } from './mcp-types';

export interface AnchorsStoreState {
  projectId: string | null;
  anchors: Anchor[];
  loading: boolean;
  error: string | null;
  source: 'real' | 'empty';
}

export interface AnchorsStoreActions {
  /** Load the anchor list for `projectId` through the MCP client. */
  hydrate: (projectId: string) => Promise<void>;
  /** Hydrate-once-per-project entry point for view mount effects — a no-op
   *  when this project's anchors are already loaded or already in flight. */
  ensure: (projectId: string) => void;
  /** Re-read the current project's anchors (call after a create/delete/
   *  generate so every consumer sees the write). */
  refresh: () => Promise<void>;
  /** Reset to empty. */
  clear: () => void;
}

export type AnchorsStore = AnchorsStoreState & AnchorsStoreActions;

export const useAnchorsStore = create<AnchorsStore>((set, get) => ({
  projectId: null,
  anchors: [],
  loading: false,
  error: null,
  source: 'empty',

  hydrate: async (projectId) => {
    set({ projectId, loading: true, error: null });
    try {
      const client = await getMcpClient();
      const { anchors } = await anchorApi.list(client);
      set({ anchors: anchors ?? [], source: 'real', loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  ensure: (projectId) => {
    const state = get();
    if (state.projectId === projectId && (state.loading || state.source === 'real')) return;
    void get().hydrate(projectId);
  },

  refresh: async () => {
    const { projectId } = get();
    if (!projectId) return;
    await get().hydrate(projectId);
  },

  clear: () => set({ projectId: null, anchors: [], loading: false, error: null, source: 'empty' }),
}));

// ─── selectors ─────────────────────────────────────────────────────────

export const selectAnchors = (s: AnchorsStoreState) => s.anchors;
export const selectAnchorsLoading = (s: AnchorsStoreState) => s.loading;
export const selectAnchorsError = (s: AnchorsStoreState) => s.error;
