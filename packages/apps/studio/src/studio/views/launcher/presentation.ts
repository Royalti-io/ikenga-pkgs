// com.ikenga.studio · Launcher — presentation + honesty helpers
//
// Pure functions the Launcher and its subcomponents share. The "honesty rule"
// lives here: normalizeRecent() reads ONLY the fields project.list actually
// returns and leaves archetype/aspect/cell-count undefined for real rows (the
// sidecar's ProjectSummary carries none of them), so the row renderer can drop
// the decorations that would otherwise be faked.

import type { CSSProperties } from 'react';

import { presentationFor } from '../../__mocks__/launcher';
import type { AspectRatio } from '../../mcp-types';
import type { RawRecentProject } from '../../mcp-client';

/** Role-accent inline style for an archetype card / chip. 'cyan' has no
 *  --beat-accent- token, so it falls back to --info (the closest cool role). */
export function accentStyle(accent: string): CSSProperties {
  const varName = accent === 'cyan' ? '--info' : `--beat-accent-${accent}`;
  return {
    color: `var(${varName})`,
    background:
      accent === 'cyan'
        ? 'color-mix(in srgb, var(--info) 14%, transparent)'
        : `var(${varName}-soft)`,
    borderColor:
      accent === 'cyan'
        ? 'color-mix(in srgb, var(--info) 34%, var(--border))'
        : `var(${varName}-border)`,
  };
}

// ─── Phase derivation (audit: launcher-p1-badge-contradicts-engine-phase) ──
//
// The old card hardcoded a green "P1" on EVERY archetype, even ones whose own
// engine tag says Remotion (P2) / AI (P3). Derive the phase from the same
// presentation entry's engine string so a P2/P3 archetype reads honestly and
// its create action is disabled.

export type Phase = 'p1' | 'p2' | 'p3';

export interface PhaseInfo {
  phase: Phase;
  /** Short badge label. */
  label: string;
  /** True only for HyperFrames-available (P1) archetypes. */
  available: boolean;
}

export function derivePhase(archetypeId: string): PhaseInfo {
  const engine = presentationFor(archetypeId).engine; // 'HF' | 'HF · Remotion (P2)' | 'HF · AI (P3)'
  if (/\bAI\b/.test(engine) || /P3/.test(engine)) {
    return { phase: 'p3', label: 'AI · P3', available: false };
  }
  if (/Remotion/i.test(engine) || /P2/.test(engine)) {
    return { phase: 'p2', label: 'Remotion · P2', available: false };
  }
  return { phase: 'p1', label: 'Available', available: true };
}

// ─── Recents normalization (audit: launcher-recents-static-fixture) ────────

export interface RecentRow {
  id: string;
  name: string;
  path: string;
  /** Epoch ms of last-open, or null when the seam didn't carry a timestamp. */
  lastOpened: number | null;
  /** Present ONLY when the row came from a full Project (standalone/mock). Real
   *  project.list ProjectSummary rows omit these — never fabricate them. */
  archetype_id?: string;
  aspect?: AspectRatio;
  cellCount?: number;
}

export function normalizeRecent(raw: RawRecentProject): RecentRow | null {
  const id = (raw.project_id ?? raw.projectId ?? raw.slug ?? '') as string;
  if (!id) return null;
  const name = (raw.name ?? raw.title ?? raw.slug ?? id) as string;
  const path = (raw.path ?? '') as string;

  let lastOpened: number | null = null;
  if (typeof raw.lastOpened === 'number') {
    lastOpened = raw.lastOpened;
  } else if (typeof raw.updated_at === 'string') {
    const t = Date.parse(raw.updated_at);
    if (!Number.isNaN(t)) lastOpened = t;
  }

  const row: RecentRow = { id, name, path, lastOpened };
  if (typeof raw.archetype_id === 'string') row.archetype_id = raw.archetype_id;
  if (typeof raw.aspect_ratio === 'string') row.aspect = raw.aspect_ratio as AspectRatio;
  if (Array.isArray(raw.cells)) row.cellCount = raw.cells.length;
  return row;
}

/** Compact "opened N ago" from an epoch ms. Empty string when unknown. */
export function formatAgo(ms: number | null): string {
  if (ms == null) return '';
  const diff = Date.now() - ms;
  if (diff < 45_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
