/**
 * export.prompt_package — platform-shaped prompt handoff (Stage 4, Track B).
 *
 * Some target generators (Higgsfield, Google Flow, Veo, …) have no public API
 * you can drive from the sidecar the way the `fal` adapter drives fal.ai. For
 * those, the studio produces a *prompt bundle*: a per-cell, platform-shaped
 * prompt + the resolved reference image + framing/camera/duration metadata a
 * filmmaker can paste into the target's own UI. The returned clip comes back
 * through `render.ingest_external`.
 *
 * The per-platform shaping lives in a small pure template map (`SHAPERS`) so a
 * new target is one entry, not a new branch scattered through the handler.
 *
 * Output is BOTH returned to the caller AND written to
 * `<projectRoot>/prompts/<platform>/<cellId | 'all'>.json` so the bundle is a
 * durable artifact the user can hand off outside the shell.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_RESOLUTION,
  type AspectRatio,
  type Anchor,
  type Cell,
  type CameraMove,
  type ShotType,
} from '@ikenga/studio-schema';

import { readProject } from './storyboard-fs.js';
import { resolveAsset } from './assets.js';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export const PLATFORMS = ['higgsfield', 'flow', 'veo', 'generic'] as const;
export type PromptPlatform = (typeof PLATFORMS)[number];

export function isPromptPlatform(v: unknown): v is PromptPlatform {
  return typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);
}

/** One camera descriptor threaded into the shaper + surfaced on the package. */
export interface CameraSpec {
  shot_type: ShotType;
  camera_move: CameraMove;
  camera_text?: string;
}

/** Normalized inputs handed to every per-platform shaper. */
export interface ShapeInputs {
  label: string;
  prompt: string;
  camera: CameraSpec;
  duration_ms: number;
  aspect_ratio: AspectRatio;
  ref_image_uri: string | null;
  /** Optional audio-cue reference (from `Cell.audio_cue`) — used by the veo shaper. */
  audio_cue_uri: string | null;
}

/** One cell's shaped prompt bundle (also the JSON element written to disk). */
export interface PromptPackage {
  cellId: string;
  platform: PromptPlatform;
  prompt: string;
  ref_image_uri: string | null;
  aspect_ratio: AspectRatio;
  duration_ms: number;
  camera: CameraSpec;
}

export interface PromptPackageResult {
  result: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// Phrase maps (shared by the shapers)
// ─────────────────────────────────────────────────────────────────────────

const SHOT_TYPE_PHRASE: Record<ShotType, string> = {
  ews: 'extreme wide shot',
  ws: 'wide shot',
  ls: 'long shot',
  fs: 'full shot',
  ms: 'medium shot',
  cu: 'close-up',
  ecu: 'extreme close-up',
  ots: 'over-the-shoulder shot',
  pov: 'point-of-view shot',
  insert: 'insert shot',
  aerial: 'aerial shot',
  unset: '',
};

const CAMERA_MOVE_PHRASE: Record<CameraMove, string> = {
  static: 'static locked-off camera',
  pan: 'camera pans',
  tilt: 'camera tilts',
  dolly: 'dolly move',
  truck: 'trucking move',
  crane: 'crane move',
  handheld: 'handheld camera',
  'zoom-in': 'slow zoom in',
  'zoom-out': 'slow zoom out',
  orbit: 'orbiting camera',
  unset: '',
};

const SECONDS = (ms: number): string => (ms > 0 ? `${(ms / 1000).toFixed(1)}s` : 'unspecified');

/** Human camera clause, e.g. "close-up, slow zoom in". Empty when nothing set. */
function cameraClause(cam: CameraSpec): string {
  const parts = [SHOT_TYPE_PHRASE[cam.shot_type], CAMERA_MOVE_PHRASE[cam.camera_move]]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.join(', ');
}

// ─────────────────────────────────────────────────────────────────────────
// Per-platform shapers (pure) — one entry per target; easy to extend.
// ─────────────────────────────────────────────────────────────────────────

const SHAPERS: Record<PromptPlatform, (i: ShapeInputs) => string> = {
  // Higgsfield leads with camera-move presets, so the motion is stated up front.
  higgsfield: (i) => {
    const cam = cameraClause(i.camera);
    const lines: string[] = [];
    if (cam) lines.push(`Camera: ${cam}.`);
    lines.push(i.prompt.trim() || i.label);
    if (i.camera.camera_text && i.camera.camera_text.trim()) {
      lines.push(i.camera.camera_text.trim());
    }
    lines.push(`Aspect ${i.aspect_ratio}, duration ${SECONDS(i.duration_ms)}.`);
    return lines.join(' ');
  },

  // Google Flow frames reference images as "Ingredients"; scene text follows.
  flow: (i) => {
    const lines: string[] = [];
    lines.push(
      i.ref_image_uri
        ? `Ingredients: ${i.ref_image_uri} (reference — keep character/location consistent).`
        : 'Ingredients: (none — text-to-video).',
    );
    lines.push(`Scene: ${i.prompt.trim() || i.label}`);
    const cam = cameraClause(i.camera);
    if (cam) lines.push(`Shot: ${cam}.`);
    if (i.camera.camera_text && i.camera.camera_text.trim()) {
      lines.push(`Notes: ${i.camera.camera_text.trim()}`);
    }
    lines.push(`Format: ${i.aspect_ratio}, ${SECONDS(i.duration_ms)}.`);
    return lines.join('\n');
  },

  // Veo generates native audio, so surface an explicit audio cue hint.
  veo: (i) => {
    const lines: string[] = [];
    lines.push(i.prompt.trim() || i.label);
    const cam = cameraClause(i.camera);
    if (cam) lines.push(`${cam}.`);
    if (i.camera.camera_text && i.camera.camera_text.trim()) {
      lines.push(i.camera.camera_text.trim());
    }
    lines.push(
      i.audio_cue_uri
        ? `Audio: sync to reference cue ${i.audio_cue_uri}; add matching ambient sound and light foley.`
        : 'Audio: generate fitting ambient sound and subtle foley; no dialogue unless specified.',
    );
    lines.push(`Aspect ${i.aspect_ratio}, ${SECONDS(i.duration_ms)}.`);
    return lines.join(' ');
  },

  // Generic: plain prompt with a light camera tail; no platform idioms.
  generic: (i) => {
    const parts = [i.prompt.trim() || i.label];
    const cam = cameraClause(i.camera);
    if (cam) parts.push(cam);
    if (i.camera.camera_text && i.camera.camera_text.trim()) {
      parts.push(i.camera.camera_text.trim());
    }
    return parts.join('. ') + '.';
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Reference resolution + package assembly
// ─────────────────────────────────────────────────────────────────────────

// Anchor kinds that carry a usable reference plate (mirror of fal.ts).
const REF_ANCHOR_KINDS = new Set<Anchor['kind']>(['character', 'location', 'image']);

/**
 * Resolve a cell's FIRST character/location/image anchor to an absolute uri,
 * or `null` when the cell has no such anchor. `http(s)`/`file://` uris pass
 * through; project-relative anchor uris resolve through `resolveAsset` (which
 * yields an absolute `file://` uri when the file exists on disk).
 */
function resolveRefImageUri(
  projectRoot: string,
  cell: Cell,
  anchorsById: Map<string, Anchor>,
): string | null {
  if (!cell.anchors || cell.anchors.length === 0) return null;
  for (const id of cell.anchors) {
    const a = anchorsById.get(id);
    if (!a || !REF_ANCHOR_KINDS.has(a.kind)) continue;
    const uri = a.asset?.uri;
    if (!uri) continue;
    if (/^(https?|file):\/\//i.test(uri)) return uri;
    // Project-relative — resolve to an absolute file:// uri via the asset seam.
    const resolved = resolveAsset(projectRoot, uri).result.asset as
      | { uri?: string }
      | undefined;
    return resolved?.uri ?? uri;
  }
  return null;
}

function packageCell(
  projectRoot: string,
  cell: Cell,
  platform: PromptPlatform,
  aspect: AspectRatio,
  anchorsById: Map<string, Anchor>,
): PromptPackage {
  const camera: CameraSpec = {
    shot_type: cell.shot_type,
    camera_move: cell.camera_move,
    camera_text: cell.camera_text,
  };
  const ref = resolveRefImageUri(projectRoot, cell, anchorsById);
  const audioCue = cell.audio_cue?.uri ?? null;
  const inputs: ShapeInputs = {
    label: cell.label,
    prompt: cell.prompt,
    camera,
    duration_ms: cell.duration_ms,
    aspect_ratio: aspect,
    ref_image_uri: ref,
    audio_cue_uri: audioCue,
  };
  return {
    cellId: cell.uid,
    platform,
    prompt: SHAPERS[platform](inputs),
    ref_image_uri: ref,
    aspect_ratio: aspect,
    duration_ms: cell.duration_ms,
    camera,
  };
}

/**
 * Build a platform-shaped prompt bundle for one cell (`cellId` set) or every
 * cell (`cellId` omitted). Writes the bundle to
 * `<projectRoot>/prompts/<platform>/<cellId | 'all'>.json` and returns it.
 */
export function buildPromptPackage(
  projectRoot: string,
  params: { cellId?: string; platform: unknown },
): PromptPackageResult {
  if (!isPromptPlatform(params.platform)) {
    return {
      result: {
        ok: false,
        error: 'invalid-args',
        message: `platform must be one of ${PLATFORMS.join('|')}`,
      },
    };
  }
  const platform = params.platform;

  const project = readProject(projectRoot);
  const aspect = (project.aspect_ratio as AspectRatio) ?? '16:9';
  const anchorsById = new Map<string, Anchor>(project.anchors.map((a) => [a.id, a]));

  let cells: Cell[];
  if (typeof params.cellId === 'string' && params.cellId.length > 0) {
    const cell = project.cells.find((c) => c.uid === params.cellId);
    if (!cell) {
      return { result: { ok: false, error: 'cell-not-found', message: params.cellId } };
    }
    cells = [cell];
  } else {
    cells = project.cells;
  }

  const packages = cells.map((c) =>
    packageCell(projectRoot, c, platform, aspect, anchorsById),
  );

  // Persist the bundle as a durable handoff artifact.
  const outDir = join(projectRoot, 'prompts', platform);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const fileBase = typeof params.cellId === 'string' && params.cellId.length > 0
    ? params.cellId
    : 'all';
  const outPath = join(outDir, `${fileBase}.json`);
  const bundle = {
    schema: 'ikenga.studio.prompt_package/1',
    platform,
    project: project.slug,
    generated_at: new Date().toISOString(),
    default_resolution: DEFAULT_RESOLUTION[aspect],
    packages,
  };
  writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  return { result: { ok: true, platform, path: outPath, count: packages.length, packages } };
}
