/**
 * `canvas.*` RPC implementations — the AUTHORED canvas layout store (Plan 25).
 *
 * Plan 25's "Where state lives" table is explicit: derived nodes/edges are
 * recomputed and never persisted, while **authored** state (positions, groups,
 * collapse, viewport) lives in `<projectRoot>/.studio/canvas.json` — never in
 * `storyboard.json`, which agents rewrite wholesale, and never in browser
 * localStorage, which is invisible to the watcher, to a second machine and to
 * the agent (G-76 #1).
 *
 * Two rules this file exists to keep:
 *
 *  1. **One watcher emit per save.** `.studio/**` is already in the watcher's
 *     WATCH_GLOBS (WP-29), and it is watched as a DIRECTORY — so a scratch file
 *     written inside `.studio/` would itself fire an event on top of the one for
 *     `canvas.json`. The tmp file therefore lands in the project ROOT (which is
 *     not a watch target; only named files and named subdirectories are) and is
 *     `rename()`d into `.studio/canvas.json`. Same volume, so the rename is
 *     atomic: the watcher sees exactly one `add`/`change` for the final bytes,
 *     and a reader never observes a half-written document.
 *
 *  2. **No direct emit.** Like storyboard-fs.ts, the write relies on the watcher
 *     for event emission rather than emitting itself — otherwise every canvas
 *     save would double-fire.
 *
 * `.studio/` is created at project-open time (index.ts) so the watcher, which
 * prunes not-yet-existing targets at watch start, actually has it to watch.
 *
 * Shape note: the Zod schema below is sidecar-local, exactly like `rpc-types.ts`
 * — `canvas.json` is a UI-authored document with no schema obligations to the
 * renderer adapters or the exporter, so it does NOT belong in
 * `@ikenga/studio-schema` (which is the contract the render/export paths parse).
 * The iframe mirrors the shape in `src/studio/lib/canvas-doc.ts`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

export const STUDIO_DIR = '.studio';
export const CANVAS_FILE = 'canvas.json';

const PlacementSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
});

const ViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite().positive(),
});

/** D-25-1 — `group` is the only true container. A shot lives in at most one
 *  group (the UI enforces single membership on assign); stages relate to shots
 *  by edge + badge and never own them. */
const CanvasGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  color: z.string().optional(),
  shotUids: z.array(z.string()).default([]),
  collapsed: z.boolean().default(false),
});

export const CanvasDocSchema = z.object({
  schema_version: z.literal(1).default(1),
  /** Authored placements keyed by node id. Derived lane placements are NOT
   *  persisted here — see D-25-5 / the UI's `authoredOnly()`. */
  layout: z.record(PlacementSchema).default({}),
  groups: z.array(CanvasGroupSchema).default([]),
  /** Node ids whose body is collapsed (shots, groups). */
  collapsed: z.array(z.string()).default([]),
  /** D-25-5 — the sequence lane collapsed to a single strip. */
  lane_collapsed: z.boolean().default(false),
  viewport: ViewportSchema.nullable().default(null),
  /**
   * D-25-2 lazy orphan-GC. When a cell disappears from `storyboard.json` its
   * placement is NOT deleted — it is TOMBSTONED here (`uid` → epoch ms first
   * seen missing) and only swept at an explicit lazy point (project open, past
   * the grace window). An agent mid-rewrite must not scatter the arrangement.
   */
  orphans: z.record(z.number()).default({}),
  updated_at: z.string().default(''),
});
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;

export interface CanvasResult {
  result: Record<string, unknown>;
}

export function canvasPath(projectRoot: string): string {
  return join(projectRoot, STUDIO_DIR, CANVAS_FILE);
}

/** Create `<projectRoot>/.studio/` when absent. Called at project open so the
 *  watcher — which drops not-yet-existing targets at watch start (see
 *  watcher.ts's Windows note) — has a real directory to attach to. */
export function ensureStudioDir(projectRoot: string): string {
  const dir = join(projectRoot, STUDIO_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Read the authored canvas document. A project that has never been arranged has
 * no file — that is `exists:false` with a `null` doc, NOT an error (same
 * contract as `storyboard.read_cell_content` / `read_fountain`). A file that is
 * present but unparseable IS an error: silently substituting an empty document
 * would look identical to "never arranged" and the next save would overwrite
 * the user's real arrangement with the blank one.
 */
export function readCanvas(projectRoot: string): CanvasResult {
  const abs = canvasPath(projectRoot);
  if (!existsSync(abs)) {
    return { result: { ok: true, exists: false, doc: null, path: abs } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
  } catch (e) {
    return {
      result: { ok: false, error: 'invalid-canvas-json', message: (e as Error).message, path: abs },
    };
  }
  const parsed = CanvasDocSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      result: { ok: false, error: 'invalid-canvas-json', message: parsed.error.message, path: abs },
    };
  }
  return { result: { ok: true, exists: true, doc: parsed.data, path: abs } };
}

/**
 * Re-validate + atomically persist the authored canvas document. Bumps
 * `updated_at`. See the file header for why the tmp file lives in the project
 * root rather than beside the target.
 */
export function writeCanvas(projectRoot: string, docInput: unknown): CanvasResult {
  const parsed = CanvasDocSchema.safeParse(docInput);
  if (!parsed.success) {
    return { result: { ok: false, error: 'invalid-args', message: parsed.error.message } };
  }
  const doc: CanvasDoc = { ...parsed.data, updated_at: new Date().toISOString() };
  const dir = ensureStudioDir(projectRoot);
  const abs = join(dir, CANVAS_FILE);
  const body = JSON.stringify(doc, null, 2) + '\n';
  // NOT `join(dir, …)`: a tmp inside the watched `.studio/` directory would fire
  // its own create+unlink events alongside the one for canvas.json.
  const tmp = join(projectRoot, `.canvas.${randomUUID().slice(0, 8)}.tmp.json`);
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, abs);
  return {
    result: { ok: true, path: abs, bytes: Buffer.byteLength(body, 'utf8'), doc },
  };
}
