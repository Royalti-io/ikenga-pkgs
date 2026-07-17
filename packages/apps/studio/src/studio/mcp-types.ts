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

import type { BeatStatus, AspectRatio, Rung, ShotType, CameraMove } from '@ikenga/studio-schema';

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
  /** Nullable on the wire: the fal adapter really reports `null` here
   *  (renderers/fal.ts) meaning "no advertised cap", and this was typed as a
   *  plain `number` — every consumer that only survived it did so by accident,
   *  because `null` is falsy. Callers must treat `null` as "unknown / no cap",
   *  NOT as zero. */
  max_duration_ms: number | null;
  supported_codecs: string[];
  requires_network: boolean;
  // G2 capability booleans (renderers/types.ts `RendererAdapter.capabilities`).
  // On the real registry row these live NESTED under `.capabilities`; real-mcp's
  // `render.list_engines` case flattens them up so the UI reads `engine.still`
  // etc. the same in mock and real mode. Optional so the mock's flat rows (and
  // older sidecars) still satisfy the type. Lets the UI gate on, e.g., fal's
  // still-vs-video support.
  still?: boolean;
  video?: boolean;
  interactive?: boolean;
  range?: boolean;
  combine?: boolean;
}

// ─── Batched poster read (render.list_posters — Wave 2, review §2.5) ────
//
// One round-trip for every Canvas tile's poster instead of N concurrent
// `render.read_poster` calls. `b64` is `null` for a record with no poster
// yet or an unreadable file — a single missing poster never fails the batch.

export interface PosterEntry {
  recordId: string;
  b64: string | null;
}

// ─── Prompt-package handoff (export.prompt_package — WF-1) ───────────────
//
// Platform-shaped prompt bundle for a target generator with no API (Higgsfield,
// Google Flow, Veo, generic). Shape inferred from mcp/src/tools/export.ts +
// sidecars/project/src/prompt-package.ts. NOTE the per-cell element keys `cellId`
// (camelCase) — real-mcp passes the sidecar's `packages[]` through verbatim, so
// this is the exact wire shape the views receive, including the optional
// `ref_note` the sidecar computes when a ref image is local or unresolvable.
// The returned clip comes back via render.ingest_external.

export type PromptPlatform = 'higgsfield' | 'flow' | 'veo' | 'generic';

/** One cell's shaped prompt entry (the element of `PromptPackage.packages`). */
export interface PromptPackageEntry {
  cellId: string;
  platform: PromptPlatform;
  prompt: string;
  ref_image_uri: string | null;
  /** Portability note for the ref image (local file → upload to target; missing → none). */
  ref_note?: string | null;
  aspect_ratio: AspectRatio;
  duration_ms: number;
  camera: {
    shot_type: ShotType;
    camera_move: CameraMove;
    camera_text?: string;
  };
}

/** The full bundle returned by `export.prompt_package` (also written to
 *  `<root>/prompts/<platform>/<cellId|'all'>.json` sidecar-side). */
export interface PromptPackage {
  platform: PromptPlatform;
  path: string;
  count: number;
  packages: PromptPackageEntry[];
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
