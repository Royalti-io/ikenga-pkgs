// com.ikenga.studio · MCP surface types
//
// WP-07 commit 16 (G-CANVAS + schema swap, contract §6): the canonical
// Project / Cell / Block / Archetype / RenderRecord / AssetRef / Anchor /
// Rung / AspectRatio / BeatStatus / ShotType / RenderStatus shapes now come
// straight from `@ikenga/studio-schema` (the frozen Zod schema — WP-02,
// `shared/schema.ts`). This file re-exports them so every existing
// `from './mcp-types'` / `from '../mcp-types'` import keeps resolving
// unchanged across the pkg, and layers on the small set of P1 UI/MCP-local
// additions the schema deliberately does not define:
//
//   - `Beat`             — the script-level beat summary `storyboard.read` /
//                           `block.instantiate` echo back (id/label/order/
//                           status/duration_ms). Distinct from the schema's
//                           `ScriptBeat` (lives on `Project.script`, carries
//                           vo/scene_id/shot_id, written by the Script view —
//                           not the storyboard-read beat rail).
//   - `ExportRecord`      — P1 sidecar export-job bookkeeping; not part of
//                           the persisted storyboard document.
//   - `EngineCapability`  — the render-engine capability matrix (G2); a
//                           sidecar/MCP-server concept, not a schema entity.
//   - Event payloads      — the `pkg://com.ikenga.studio/<event>` channel
//                           shapes (09 §WP-03 PRODUCES); transport, not schema.
//
// `RenderStatus` drift (contract §6): the frozen schema has NO `'idle'`
// (`'queued' | 'running' | 'done' | 'failed' | 'cancelled'` only). `'idle'`
// is a UI-local cell-editor concept — see `views/Cell.tsx`'s own local
// `RenderState` — and never belonged on the wire type; it is NOT re-added.

import type { BeatStatus, AspectRatio, Rung } from '@ikenga/studio-schema';

export type {
  // Enums / brands
  Rung,
  AspectRatio,
  BeatStatus,
  ShotType,
  CameraMove,
  RenderStatus,
  ProjectMode,
  ScriptArchetype,
  // Core entities
  AssetRef,
  Anchor,
  Block,
  BlockParameter,
  BlockParameterType,
  Archetype,
  ArchetypeChainEntry,
  Script,
  ScriptBeat,
  Comment,
  NarrationBlock,
  NarrationWord,
  AudioAnalysis,
  RenderRecord,
  Cell,
  Project,
} from '@ikenga/studio-schema';

export { RUNG_DIR, rungDir, DEFAULT_RESOLUTION } from '@ikenga/studio-schema';

// ─── P1-local additions (deliberately NOT in @ikenga/studio-schema) ─────

/** Script-level beat summary as `storyboard.read` / `block.instantiate` echo
 *  it back — the beat rail's order + duration_ms + status bookkeeping.
 *  See file header — distinct from the schema's `ScriptBeat`. */
export interface Beat {
  id: string;
  label: string;     // e.g. "Hook" / "Verse" / "Chorus" / "Bridge" / "CTA"
  order: number;
  status?: BeatStatus;
  duration_ms?: number;
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
