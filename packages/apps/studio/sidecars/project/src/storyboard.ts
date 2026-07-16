/**
 * storyboard.* RPC implementations (WP-03b).
 *
 * Operates on `<projectRoot>/storyboard.json` (the `Project.cells[]` array is
 * the source of truth for cell records) plus the per-cell working directory
 * at `<projectRoot>/cells/<rungDir>/<uid>/`. Each mutation re-validates the
 * whole project through the Zod schema and persists atomically via
 * `writeProjectAtomic` (tmp+rename), then returns the updated project so the
 * caller (index.ts) can refresh its in-memory copy.
 *
 * Event emission: storyboard.json lives under a watched path, so the FS
 * watcher emits `cells/changed` after the rename lands. We do NOT emit
 * directly here (see storyboard-fs.ts) to avoid double-emit.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  CellSchema,
  ScriptBeatSchema,
  rungDir,
  type Cell,
  type Project,
  type Rung,
} from '@ikenga/studio-schema';

import { readProject, writeProjectAtomic } from './storyboard-fs.js';

export interface StoryboardResult {
  result: Record<string, unknown>;
  /** Updated project document when a mutation persisted; undefined for reads. */
  project?: Project;
}

/** Ensure the on-disk working dir for a cell exists: cells/<rungDir>/<uid>/. */
function ensureCellDir(projectRoot: string, rung: Rung, uid: string): string {
  const dir = join(projectRoot, 'cells', rungDir(rung), uid);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── reads ────────────────────────────────────────────────────────────────

export function read(projectRoot: string): StoryboardResult {
  const project = readProject(projectRoot);
  return {
    result: {
      ok: true,
      project,
      cellIndex: project.cells.map((c) => ({ uid: c.uid, beat_id: c.beat_id, rung: c.rung })),
    },
  };
}

export function readCell(projectRoot: string, cellId: string): StoryboardResult {
  const project = readProject(projectRoot);
  const cell = project.cells.find((c) => c.uid === cellId);
  if (!cell) {
    return { result: { ok: false, error: 'cell-not-found', message: cellId } };
  }
  return { result: { ok: true, cell } };
}

export function listCells(
  projectRoot: string,
  filter: { beat_id?: string; rung?: Rung } = {},
): StoryboardResult {
  const project = readProject(projectRoot);
  let cells = project.cells;
  if (filter.beat_id) cells = cells.filter((c) => c.beat_id === filter.beat_id);
  if (filter.rung) cells = cells.filter((c) => c.rung === filter.rung);
  return { result: { ok: true, cells } };
}

/** Absolute on-disk path of a cell's authored source (content_path is stored
 *  relative to the project root; render-runner.ts uses the same resolution). */
function absContentPath(projectRoot: string, cell: Cell): string {
  return isAbsolute(cell.content_path) ? cell.content_path : resolve(projectRoot, cell.content_path);
}

/**
 * Read a cell's authored source file (the HF/Remotion/Excalidraw markup at
 * `content_path`). The Cell record itself carries only the pointer; this is the
 * seam the Cell-view editor uses to load the REAL content instead of a fixture.
 * `exists:false` (empty html) is a legitimate state for a freshly-created cell
 * whose author hasn't written the source yet — not an error.
 */
export function readCellContent(projectRoot: string, cellId: string): StoryboardResult {
  const project = readProject(projectRoot);
  const cell = project.cells.find((c) => c.uid === cellId);
  if (!cell) {
    return { result: { ok: false, error: 'cell-not-found', message: cellId } };
  }
  const abs = absContentPath(projectRoot, cell);
  const exists = existsSync(abs);
  const html = exists ? readFileSync(abs, 'utf8') : '';
  return { result: { ok: true, cellId, content_path: cell.content_path, exists, html } };
}

/**
 * Write a cell's authored source file (the save seam for the Cell-view editor).
 * Persists the FULL edited html to `content_path` (creating the cell dir if
 * needed) and bumps `last_edited` on the record so Canvas / records reflect the
 * save. This is the durable counterpart the old blur-persist path was missing —
 * the render runner reads the same file, so a saved edit renders next time.
 */
export function writeCellContent(
  projectRoot: string,
  cellId: string,
  html: unknown,
): StoryboardResult {
  if (typeof html !== 'string') {
    return { result: { ok: false, error: 'invalid-args', message: 'html must be a string' } };
  }
  const project = readProject(projectRoot);
  const idx = project.cells.findIndex((c) => c.uid === cellId);
  if (idx < 0) {
    return { result: { ok: false, error: 'cell-not-found', message: cellId } };
  }
  const cell = project.cells[idx];
  const abs = absContentPath(projectRoot, cell);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html, 'utf8');
  // Bump last_edited so the storyboard doc + Canvas freshness track the save.
  const cells = project.cells.slice();
  cells[idx] = { ...cell, last_edited: new Date().toISOString() };
  const next = writeProjectAtomic(projectRoot, { ...project, cells });
  return {
    result: {
      ok: true,
      cellId,
      content_path: cell.content_path,
      bytes: Buffer.byteLength(html, 'utf8'),
    },
    project: next,
  };
}

/**
 * Read the project's Fountain screenplay source at `<projectRoot>/script.fountain`.
 * Same shape/contract as readCellContent: `exists:false` (empty text) is a
 * legitimate state for a project with no `.fountain` on disk (not an error) —
 * the Script view's Fountain mode renders the real text when present and an
 * honest "no script.fountain" note when absent, rather than faking a screenplay.
 */
export function readFountain(projectRoot: string): StoryboardResult {
  const abs = join(projectRoot, 'script.fountain');
  const exists = existsSync(abs);
  const text = exists ? readFileSync(abs, 'utf8') : '';
  return { result: { ok: true, exists, text } };
}

/**
 * Write the project's Fountain screenplay source to `<projectRoot>/script.fountain`
 * (UTF-8). Mirrors readFountain's seam: the durable save for the Script view's
 * Fountain mode and the Chi authoring flow. Replaces the file wholesale (there
 * is no patch-level edit for a Fountain source). The FS watcher emits
 * `cells/changed` on the project root, so callers refetch as needed.
 */
export function writeFountain(projectRoot: string, text: unknown): StoryboardResult {
  if (typeof text !== 'string') {
    return { result: { ok: false, error: 'invalid-args', message: 'text must be a string' } };
  }
  const abs = join(projectRoot, 'script.fountain');
  writeFileSync(abs, text, 'utf8');
  return {
    result: {
      ok: true,
      exists: true,
      bytes: Buffer.byteLength(text, 'utf8'),
    },
  };
}

// ─── mutations ──────────────────────────────────────────────────────────────

export function createCell(projectRoot: string, cellInput: unknown): StoryboardResult {
  const parsed = CellSchema.safeParse(cellInput);
  if (!parsed.success) {
    return { result: { ok: false, error: 'invalid-args', message: parsed.error.message } };
  }
  const cell = parsed.data;
  const project = readProject(projectRoot);
  if (project.cells.some((c) => c.uid === cell.uid)) {
    return { result: { ok: false, error: 'cell-already-exists', message: cell.uid } };
  }
  ensureCellDir(projectRoot, cell.rung, cell.uid);
  const next = writeProjectAtomic(projectRoot, {
    ...project,
    cells: [...project.cells, cell],
  });
  return { result: { ok: true, cell }, project: next };
}

export function writeCell(projectRoot: string, cellInput: unknown): StoryboardResult {
  const parsed = CellSchema.safeParse(cellInput);
  if (!parsed.success) {
    return { result: { ok: false, error: 'invalid-args', message: parsed.error.message } };
  }
  const cell: Cell = { ...parsed.data, last_edited: new Date().toISOString() };
  const project = readProject(projectRoot);
  const idx = project.cells.findIndex((c) => c.uid === cell.uid);
  if (idx < 0) {
    return { result: { ok: false, error: 'cell-not-found', message: cell.uid } };
  }
  ensureCellDir(projectRoot, cell.rung, cell.uid);
  const cells = project.cells.slice();
  cells[idx] = cell;
  const next = writeProjectAtomic(projectRoot, { ...project, cells });
  return { result: { ok: true, cell }, project: next };
}

export function deleteCell(projectRoot: string, cellId: string): StoryboardResult {
  const project = readProject(projectRoot);
  const idx = project.cells.findIndex((c) => c.uid === cellId);
  if (idx < 0) {
    return { result: { ok: false, error: 'cell-not-found', message: cellId } };
  }
  const cells = project.cells.filter((c) => c.uid !== cellId);
  // We leave the on-disk cell dir in place (content files may be recoverable);
  // removing the record from storyboard.json is the authoritative delete.
  const next = writeProjectAtomic(projectRoot, { ...project, cells });
  return { result: { ok: true, cellId }, project: next };
}

export function setApproved(
  projectRoot: string,
  cellId: string,
  approved: boolean,
): StoryboardResult {
  const project = readProject(projectRoot);
  const idx = project.cells.findIndex((c) => c.uid === cellId);
  if (idx < 0) {
    return { result: { ok: false, error: 'cell-not-found', message: cellId } };
  }
  const cells = project.cells.slice();
  cells[idx] = { ...cells[idx], approved, last_edited: new Date().toISOString() };
  const next = writeProjectAtomic(projectRoot, { ...project, cells });
  return { result: { ok: true, cell: cells[idx] }, project: next };
}

/** Upsert a script-level beat into project.script.beats[]. */
export function upsertBeat(projectRoot: string, beatInput: unknown): StoryboardResult {
  const parsed = ScriptBeatSchema.safeParse(beatInput);
  if (!parsed.success) {
    return { result: { ok: false, error: 'invalid-args', message: parsed.error.message } };
  }
  const beat = parsed.data;
  const project = readProject(projectRoot);
  if (!project.script) {
    return {
      result: {
        ok: false,
        error: 'no-script',
        message: 'project has no script; upsert_beat requires an existing script document',
      },
    };
  }
  const beats = project.script.beats.slice();
  const idx = beats.findIndex((b) => b.id === beat.id);
  if (idx < 0) beats.push(beat);
  else beats[idx] = beat;
  const next = writeProjectAtomic(projectRoot, {
    ...project,
    script: { ...project.script, beats },
  });
  return { result: { ok: true, beat }, project: next };
}

/**
 * Upsert a per-rung block (beatsheet / lofi / hifi) on a cell. `rung` is the
 * partial rung object; we merge it onto the named rung key. The rung key is
 * derived from the rung object's own shape via `rungKey`.
 */
export function upsertRung(
  projectRoot: string,
  cellId: string,
  rungInput: unknown,
  rungKey?: string,
): StoryboardResult {
  if (typeof rungInput !== 'object' || rungInput === null) {
    return { result: { ok: false, error: 'invalid-args', message: 'rung must be an object' } };
  }
  const project = readProject(projectRoot);
  const idx = project.cells.findIndex((c) => c.uid === cellId);
  if (idx < 0) {
    return { result: { ok: false, error: 'cell-not-found', message: cellId } };
  }
  const cell = project.cells[idx];
  // Default the target rung key to the cell's own rung when not given.
  const key = rungKey ?? cell.rung;
  const VALID_KEYS = new Set(['0_beat_sheet', '1_lofi', '2_hifi']);
  if (!VALID_KEYS.has(key)) {
    return {
      result: {
        ok: false,
        error: 'invalid-args',
        message: `rungKey must be one of 0_beat_sheet|1_lofi|2_hifi (got ${key})`,
      },
    };
  }
  const existingRung = (cell.rungs as Record<string, Record<string, unknown>>)[key] ?? {};
  const mergedRungs = {
    ...cell.rungs,
    [key]: { ...existingRung, ...(rungInput as Record<string, unknown>) },
  };
  const reparsed = CellSchema.safeParse({
    ...cell,
    rungs: mergedRungs,
    last_edited: new Date().toISOString(),
  });
  if (!reparsed.success) {
    return { result: { ok: false, error: 'invalid-args', message: reparsed.error.message } };
  }
  const cells = project.cells.slice();
  cells[idx] = reparsed.data;
  const next = writeProjectAtomic(projectRoot, { ...project, cells });
  return { result: { ok: true, cell: reparsed.data }, project: next };
}
