// com.ikenga.studio · authored canvas document (Plan 25 "Where state lives")
//
// The iframe-side mirror of the sidecar's Zod shape in
// `sidecars/project/src/canvas.ts`. This is the ONLY home for authored canvas
// state — node placements, groups, collapse, sequence-lane state, viewport.
// It lives on disk at `<project>/.studio/canvas.json`, watched, so an
// arrangement made on one machine shows up on another and is legible to the
// agent. It is deliberately NOT localStorage (invisible to the watcher, and it
// silently diverges per browser profile) and deliberately NOT storyboard.json
// (which agents rewrite wholesale).
//
// Derived material — the nodes themselves, every edge, the lane's default
// placements — is recomputed on each render and never persisted here.

import type { ItemId, Placement, Viewport } from '@ikenga/contract/canvas';

/** D-25-1 — a group is the only true CONTAINER. A shot belongs to at most one.
 *  Stage relationships are edges + badges, never containment, so the hierarchy
 *  stays a strict tree and a shot never needs two parents. */
export interface CanvasGroup {
  id: string;
  title: string;
  color?: string;
  shotUids: string[];
  collapsed: boolean;
}

export interface CanvasDoc {
  schema_version: 1;
  /** AUTHORED placements only. A shot sitting at its derived lane slot has no
   *  entry here — see `stripDerived` in NodeCanvas — so an agent reordering the
   *  board keeps moving the lane instead of being overridden by a placement the
   *  user never actually made. */
  layout: Record<string, Placement>;
  groups: CanvasGroup[];
  /** Node ids whose body is expanded/collapsed (shots + groups). */
  collapsed: string[];
  /** D-25-5 — the sequence lane collapsed to a single strip. */
  lane_collapsed: boolean;
  viewport: Viewport | null;
  /** D-25-2 — orphan TOMBSTONES: uid → epoch ms first seen missing from
   *  storyboard.json. Placements are never dropped on a refetch; they are only
   *  swept at project open once past the grace window, so an agent mid-rewrite
   *  cannot permanently scatter the arrangement. */
  orphans: Record<string, number>;
  updated_at: string;
}

export const CANVAS_DOC_VERSION = 1 as const;

/** How long an orphaned placement survives before a project-open sweep may drop
 *  it. Generous on purpose: the cost of keeping a dead placement is a few bytes;
 *  the cost of dropping a live one is the user's arrangement. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export function emptyCanvasDoc(): CanvasDoc {
  return {
    schema_version: CANVAS_DOC_VERSION,
    layout: {},
    groups: [],
    collapsed: [],
    lane_collapsed: false,
    viewport: null,
    orphans: {},
    updated_at: '',
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function normalizePlacement(v: unknown): Placement | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.w) || !isFiniteNumber(p.h)) {
    return null;
  }
  return { x: p.x, y: p.y, w: p.w, h: p.h };
}

/** Coerce whatever `canvas.read` handed back into a usable document. The
 *  sidecar already Zod-validates, so this is belt-and-braces for an older
 *  sidecar / a hand-edited file: an unreadable FIELD degrades to its default
 *  rather than throwing away the whole arrangement. */
export function normalizeCanvasDoc(input: unknown): CanvasDoc {
  const base = emptyCanvasDoc();
  if (!input || typeof input !== 'object') return base;
  const d = input as Record<string, unknown>;

  const layout: Record<string, Placement> = {};
  if (d.layout && typeof d.layout === 'object') {
    for (const [k, v] of Object.entries(d.layout as Record<string, unknown>)) {
      const p = normalizePlacement(v);
      if (p) layout[k] = p;
    }
  }

  const groups: CanvasGroup[] = Array.isArray(d.groups)
    ? (d.groups as unknown[]).flatMap((g) => {
        if (!g || typeof g !== 'object') return [];
        const r = g as Record<string, unknown>;
        if (typeof r.id !== 'string' || r.id.length === 0) return [];
        return [{
          id: r.id,
          title: typeof r.title === 'string' ? r.title : '',
          ...(typeof r.color === 'string' ? { color: r.color } : {}),
          shotUids: Array.isArray(r.shotUids) ? (r.shotUids as unknown[]).filter((u): u is string => typeof u === 'string') : [],
          collapsed: r.collapsed === true,
        }];
      })
    : [];

  const orphans: Record<string, number> = {};
  if (d.orphans && typeof d.orphans === 'object') {
    for (const [k, v] of Object.entries(d.orphans as Record<string, unknown>)) {
      if (isFiniteNumber(v)) orphans[k] = v;
    }
  }

  let viewport: Viewport | null = null;
  if (d.viewport && typeof d.viewport === 'object') {
    const v = d.viewport as Record<string, unknown>;
    if (isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.scale) && v.scale > 0) {
      viewport = { x: v.x, y: v.y, scale: v.scale };
    }
  }

  return {
    schema_version: CANVAS_DOC_VERSION,
    layout,
    groups,
    collapsed: Array.isArray(d.collapsed)
      ? (d.collapsed as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    lane_collapsed: d.lane_collapsed === true,
    viewport,
    orphans,
    updated_at: typeof d.updated_at === 'string' ? d.updated_at : '',
  };
}

/**
 * D-25-2 — the LAZY sweep. Called at ONE place only: project open. Given the
 * live cell uid set, it (a) clears tombstones for uids that are back, (b) marks
 * newly-missing uids with `now`, and (c) drops ONLY those whose tombstone has
 * been standing longer than the grace window.
 *
 * Deliberately NOT reactive to `cells`: running this on every watcher-driven
 * refetch is eager GC, and a refetch that catches storyboard.json mid-rewrite
 * would scatter the arrangement permanently the moment the next drag saved.
 */
export function sweepOrphans(
  doc: CanvasDoc,
  liveCellUids: Set<string>,
  isCellKey: (key: string) => boolean,
  now: number = Date.now(),
  graceMs: number = ORPHAN_GRACE_MS,
): CanvasDoc {
  const orphans: Record<string, number> = {};
  const layout: Record<string, Placement> = {};

  for (const [key, placement] of Object.entries(doc.layout)) {
    if (!isCellKey(key) || liveCellUids.has(key)) {
      // Present (or not a cell key at all) — no tombstone, always kept.
      layout[key] = placement;
      continue;
    }
    const since = doc.orphans[key] ?? now;
    if (now - since >= graceMs) continue; // swept
    orphans[key] = since;
    layout[key] = placement;
  }

  return { ...doc, layout, orphans };
}

export type { ItemId, Placement, Viewport };
