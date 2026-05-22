// com.ikenga.studio · MCP surface types (LOCAL DRAFT — swaps to schema import)
//
// The canonical types live in @ikenga/studio-schema (WP-02, commit c139ad1 on
// branch studio/wp02-schema). Until WP-02 merges to ikenga-pkgs main, this
// file declares the minimal subset the iframe needs against a hand-typed
// shape that mirrors the Zod schema verbatim. WP-07 commit 16 swaps these
// declarations to:
//
//   import type {
//     Project, Cell, Beat, Block, Archetype, RenderRecord, ExportRecord, …
//   } from '@ikenga/studio-schema';
//
// The mock client (./__mocks__/mcp.ts) must satisfy these types so the day
// the swap happens, every consumer compiles unchanged. If the swap surfaces
// a type drift (the local shape doesn't match the schema), the build breaks
// loudly at commit 16 — exactly the behaviour 09's mock contract asks for.

// ─── Enums / brands ─────────────────────────────────────────────────────

export type Rung = '0_beat_sheet' | '1_lofi' | '2_hifi';
export type AspectRatio = '16:9' | '9:16' | '1:1';
export type BeatStatus = 'pending' | 'pending-review' | 'approved' | 'needs-rework';
export type ShotType =
  | 'ews' | 'ws' | 'ls' | 'fs' | 'ms' | 'cu' | 'ecu'
  | 'ots' | 'pov' | 'insert' | 'aerial' | 'unset';
export type RenderStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export const RUNG_DIR: Record<Rung, string> = {
  '0_beat_sheet': 'beatsheet',
  '1_lofi':       'lofi',
  '2_hifi':       'hifi',
};
export const rungDir = (r: Rung): string => RUNG_DIR[r];

// ─── Core entities ──────────────────────────────────────────────────────

export interface AssetRef {
  uri: string;
  mime?: string;
}

export interface RenderRecord {
  record_id: string;
  cell_uid: string;
  rung: Rung;
  engine: string;
  status: RenderStatus;
  frame?: number;        // 0..1 progress fraction
  output_uri?: string;   // present on status='done'
  error?: string;        // present on status='failed'
}

export interface Cell {
  uid: string;
  beat_id: string;
  rung: Rung;
  approved: boolean;
  shot_type?: ShotType;
  text?: string;
  asset?: AssetRef;
  block_id?: string;
  render?: { latest?: RenderRecord };
}

export interface Beat {
  id: string;
  label: string;     // e.g. "Hook" / "Verse" / "Chorus" / "Bridge" / "CTA"
  order: number;
  status?: BeatStatus;
  duration_ms?: number;
}

export interface Project {
  project_id: string;
  schema_version: 1;
  archetype_id: string | null;
  name: string;
  aspect_ratio: AspectRatio;
  resolution: { w: number; h: number };
  approved: boolean;
}

export interface Block {
  id: string;
  kind: 'beat' | 'transition' | 'sketch';
  name: string;
  tags: string[];
}

export interface Archetype {
  id: string;
  name: string;
  description: string;
  chain: string[];    // block ids in order
}

export interface ExportRecord {
  export_id: string;
  project_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  output_uri?: string;
  rung?: Rung;
}

// ─── Engine capability matrix (G2 — Round 7) ────────────────────────────

export interface EngineCapability {
  id: string;
  aspect_ratios: AspectRatio[];
  max_duration_ms: number;
  supported_codecs: string[];
  requires_network: boolean;
}

// ─── Event payloads ─────────────────────────────────────────────────────
//
// Names match the pkg event channel from 09 §WP-03 PRODUCES:
//   pkg://com.ikenga.studio/{cells/changed, render/progress, render/done}

export interface CellsChangedEvent {
  project_id: string;
  changed_uids: string[];
}

export interface RenderProgressEvent {
  record_id: string;
  cell_uid: string;
  frame: number; // 0..1
}

export interface RenderDoneEvent {
  record_id: string;
  cell_uid: string;
  output_uri: string;
}

export type StudioEventName =
  | 'cells/changed'
  | 'render/progress'
  | 'render/done';

export interface StudioEventPayloadMap {
  'cells/changed':    CellsChangedEvent;
  'render/progress':  RenderProgressEvent;
  'render/done':      RenderDoneEvent;
}
