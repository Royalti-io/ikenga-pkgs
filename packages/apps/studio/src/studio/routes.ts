// com.ikenga.studio · view + layout enums and the per-pane router contract
//
// "Routes" here are in-iframe panes, not URL routes — the iframe owns one
// shell route (/pkg/com.ikenga.studio/) and switches panes internally. Four
// layout presets lifted from Pattern C; five sub-views; the Launcher is a
// full-bleed pre-project state that pre-empts the layout entirely (G25).

import type { ComponentType } from 'react';

// ─── Views ──────────────────────────────────────────────────────────────

export const VIEW_IDS = ['canvas', 'cell', 'composition', 'script', 'archetype'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export interface ViewMeta {
  id: ViewId;
  label: string;
  /** lucide icon name — rendered by the ViewSwitcher chip. */
  icon: string;
  /** kbd digit that selects this view in the focused pane (a11y-keyboard.html). */
  key: '1' | '2' | '3' | '4' | '5';
}

export const VIEWS: Record<ViewId, ViewMeta> = {
  canvas:      { id: 'canvas',      label: 'Canvas',      icon: 'grid-3x3',     key: '1' },
  cell:        { id: 'cell',        label: 'Cell',        icon: 'code',         key: '2' },
  composition: { id: 'composition', label: 'Composition', icon: 'film',         key: '3' },
  script:      { id: 'script',      label: 'Script',      icon: 'pen-line',     key: '4' },
  archetype:   { id: 'archetype',   label: 'Archetype',   icon: 'package',      key: '5' },
};

export const VIEW_ORDER: ViewId[] = [...VIEW_IDS];

// ─── Layouts ────────────────────────────────────────────────────────────

export const LAYOUT_IDS = ['single', 'vsplit', 'hsplit', 'tripane'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export interface LayoutMeta {
  id: LayoutId;
  label: string;
  /** number of panes this layout exposes. */
  panes: 1 | 2 | 3;
}

export const LAYOUTS: Record<LayoutId, LayoutMeta> = {
  single:  { id: 'single',  label: 'Single',      panes: 1 },
  vsplit:  { id: 'vsplit',  label: 'Vert split',  panes: 2 },
  hsplit:  { id: 'hsplit',  label: 'Horiz split', panes: 2 },
  tripane: { id: 'tripane', label: '3-pane',      panes: 3 },
};

export const LAYOUT_ORDER: LayoutId[] = [...LAYOUT_IDS];

// ─── Per-pane assignment ───────────────────────────────────────────────────
//
// Each pane slot holds one ViewId. Defaults follow 10-wp07-iframe.md §"View-
// switcher + layout presets": V-split = Canvas | Composition. Panes beyond a
// layout's count are ignored (kept so switching layouts preserves prior
// per-pane choices — switching single→tripane restores pane 2/3's last view).

export type PaneIndex = 0 | 1 | 2;

export const DEFAULT_PANE_VIEWS: Record<PaneIndex, ViewId> = {
  0: 'canvas',
  1: 'composition',
  2: 'script',
};

/** The view-component registry. Views register their concrete component here
 *  as each one lands (commits 6–11). Until a view lands, the harness renders
 *  a labelled placeholder — App.tsx falls back to PaneePlaceholder when a
 *  ViewId has no registered component. */
export type ViewComponentRegistry = Partial<Record<ViewId, ComponentType>>;
