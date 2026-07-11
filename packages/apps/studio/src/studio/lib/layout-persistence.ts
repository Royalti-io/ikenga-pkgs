// com.ikenga.studio · per-folder layout persistence
//
// The pane layout + per-pane view assignment are iframe chrome (see
// layout-store.ts). They persist per open project so that reopening a folder
// (or remounting the pane) restores the editor arrangement the user last had,
// mirroring the shell home page's layout persistence.
//
// Sink: `localStorage`, keyed by project id. The Studio iframe is served
// `srcdoc`-inlined by the shell (WP-13 delivery fix / resume-contract §1), and
// a `srcdoc` document inherits its parent's origin under WebKitGTK — so
// `localStorage` is available and stable across remounts. Every access is
// guarded: an opaque origin, private-mode, or quota error degrades silently to
// in-memory (the pre-persistence behaviour) rather than throwing into the view.

import {
  LAYOUT_IDS,
  VIEW_IDS,
  type LayoutId,
  type PaneIndex,
  type ViewId,
} from '../routes';

const KEY_PREFIX = 'com.ikenga.studio:layout:';
const PANE_INDICES: PaneIndex[] = [0, 1, 2];

export interface PersistedLayout {
  layout: LayoutId;
  paneViews: Partial<Record<PaneIndex, ViewId>>;
}

/** Resolve a usable `localStorage`, or `null` when the origin forbids it.
 *  Probes with a throwaway write so an opaque `srcdoc` origin surfaces its
 *  SecurityError here (once) instead of at every read/write site. */
function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__studio_layout_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function isLayoutId(v: unknown): v is LayoutId {
  return typeof v === 'string' && (LAYOUT_IDS as readonly string[]).includes(v);
}

function isViewId(v: unknown): v is ViewId {
  return typeof v === 'string' && (VIEW_IDS as readonly string[]).includes(v);
}

/** Load the persisted layout for a project, or `null` if none/invalid. Every
 *  field is validated against the current enums so a stale schema can't inject
 *  an unknown layout/view. */
export function loadLayout(projectId: string): PersistedLayout | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedLayout>;
    if (!isLayoutId(parsed.layout)) return null;
    const paneViews: Partial<Record<PaneIndex, ViewId>> = {};
    const rawViews = (parsed.paneViews ?? {}) as Record<number, unknown>;
    for (const idx of PANE_INDICES) {
      const v = rawViews[idx];
      if (isViewId(v)) paneViews[idx] = v;
    }
    return { layout: parsed.layout, paneViews };
  } catch {
    return null;
  }
}

/** Persist the layout for a project. No-ops (never throws) when the origin
 *  forbids storage. */
export function saveLayout(projectId: string, data: PersistedLayout): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY_PREFIX + projectId, JSON.stringify(data));
  } catch {
    // quota / opaque origin — degrade to in-memory.
  }
}
