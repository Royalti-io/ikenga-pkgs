/**
 * Render queue ops + in-memory LRU cell cache.
 *
 * The queue persists in SQLite (`render_queue` table — see ./db.ts). The
 * LRU cache is in-memory only; it's keyed by `(projectId, cellId)` with a
 * capacity of 256 entries, hydrated on `project.open` by walking
 * `<projectRoot>/cells/**` and reading every `cell.json` / `*.html` /
 * `*.tsx` / `*.excalidraw`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ExportQueueRow, RenderQueueRow } from './db.js';

// ─────────────────────────────────────────────────────────────────────────
// LRU cell cache
// ─────────────────────────────────────────────────────────────────────────

export interface CellCacheEntry {
  projectId: string;
  cellId: string;
  /** Absolute path to the cell's working directory. */
  dir: string;
  /** Parsed `cell.json` body (if present). */
  cellJson?: Record<string, unknown>;
  /** Plain-text file contents keyed by relative filename. */
  files: Record<string, string>;
  /** mtime in ms epoch of the newest file in this cell. */
  mtime: number;
}

export class CellLRU {
  private map = new Map<string, CellCacheEntry>();
  constructor(private readonly capacity: number = 256) {}

  static key(projectId: string, cellId: string): string {
    return `${projectId}::${cellId}`;
  }

  get(projectId: string, cellId: string): CellCacheEntry | undefined {
    const k = CellLRU.key(projectId, cellId);
    const e = this.map.get(k);
    if (!e) return undefined;
    // promote to most-recent
    this.map.delete(k);
    this.map.set(k, e);
    return e;
  }

  set(entry: CellCacheEntry): void {
    const k = CellLRU.key(entry.projectId, entry.cellId);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, entry);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(projectId: string, cellId: string): void {
    this.map.delete(CellLRU.key(projectId, cellId));
  }

  size(): number {
    return this.map.size;
  }

  /** Drop every entry for one project (used on project.close). */
  dropProject(projectId: string): void {
    const prefix = `${projectId}::`;
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(prefix)) this.map.delete(k);
    }
  }
}

const RELEVANT_EXT = new Set(['.json', '.html', '.tsx', '.excalidraw']);

function listCellDirs(cellsRoot: string): string[] {
  // cells/<rungDir>/<uid>/  — we walk two levels (rung + uid).
  const out: string[] = [];
  if (!existsSync(cellsRoot)) return out;
  let rungs: string[];
  try {
    rungs = readdirSync(cellsRoot);
  } catch {
    return out;
  }
  for (const rung of rungs) {
    const rungDir = join(cellsRoot, rung);
    let st;
    try {
      st = statSync(rungDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let uids: string[];
    try {
      uids = readdirSync(rungDir);
    } catch {
      continue;
    }
    for (const uid of uids) {
      const uidDir = join(rungDir, uid);
      try {
        if (statSync(uidDir).isDirectory()) out.push(uidDir);
      } catch {
        // ignore
      }
    }
  }
  return out;
}

/**
 * Walk `<projectRoot>/cells/**` and hydrate the LRU. Returns the number of
 * cells loaded plus the elapsed ms — used by `project.open` + smoke tests.
 */
export function hydrateProjectCells(
  projectId: string,
  projectRoot: string,
  lru: CellLRU,
): { count: number; elapsedMs: number } {
  const t0 = Date.now();
  const cellsRoot = join(projectRoot, 'cells');
  const dirs = listCellDirs(cellsRoot);
  let count = 0;
  for (const dir of dirs) {
    const cellId = dir.split('/').pop() ?? dir;
    const files: Record<string, string> = {};
    let cellJson: Record<string, unknown> | undefined;
    let newest = 0;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const dot = name.lastIndexOf('.');
      if (dot < 0) continue;
      const ext = name.slice(dot).toLowerCase();
      if (!RELEVANT_EXT.has(ext)) continue;
      const abs = join(dir, name);
      try {
        const st = statSync(abs);
        if (!st.isFile()) continue;
        const body = readFileSync(abs, 'utf8');
        files[name] = body;
        if (st.mtimeMs > newest) newest = st.mtimeMs;
        if (name === 'cell.json') {
          try {
            cellJson = JSON.parse(body) as Record<string, unknown>;
          } catch {
            // tolerate malformed cell.json — it shows up as missing
          }
        }
      } catch {
        // skip unreadable
      }
    }
    lru.set({ projectId, cellId, dir, cellJson, files, mtime: newest });
    count++;
  }
  return { count, elapsedMs: Date.now() - t0 };
}

// ─────────────────────────────────────────────────────────────────────────
// Render queue ops (SQLite-backed)
// ─────────────────────────────────────────────────────────────────────────

type Db = {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
};

export interface EnqueueParams {
  recordId: string;
  projectId: string;
  cellId: string;
  engine: string;
  options: unknown;
}

export function enqueue(db: Db, params: EnqueueParams): void {
  db.prepare(
    `INSERT INTO render_queue
       (record_id, project_id, cell_id, engine, options, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
  ).run(
    params.recordId,
    params.projectId,
    params.cellId,
    params.engine,
    JSON.stringify(params.options ?? {}),
    Date.now(),
  );
}

export function queueDepth(db: Db, projectId?: string): number {
  if (projectId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM render_queue
          WHERE project_id = ? AND status IN ('queued','running')`,
      )
      .get(projectId) as { n: number };
    return row?.n ?? 0;
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM render_queue WHERE status IN ('queued','running')`,
    )
    .get() as { n: number };
  return row?.n ?? 0;
}

export function listQueue(db: Db, projectId?: string): RenderQueueRow[] {
  if (projectId) {
    return db
      .prepare(
        `SELECT * FROM render_queue WHERE project_id = ? ORDER BY created_at DESC`,
      )
      .all(projectId) as RenderQueueRow[];
  }
  return db
    .prepare(`SELECT * FROM render_queue ORDER BY created_at DESC`)
    .all() as RenderQueueRow[];
}

export function markStarted(db: Db, recordId: string): void {
  db.prepare(
    `UPDATE render_queue SET status = 'running', started_at = ? WHERE record_id = ?`,
  ).run(Date.now(), recordId);
}

export function markDone(
  db: Db,
  recordId: string,
  outcome: 'done' | 'failed' | 'cancelled',
  fields: { outputPath?: string; error?: string } = {},
): void {
  db.prepare(
    `UPDATE render_queue
        SET status = ?, finished_at = ?, output_path = ?, error = ?
      WHERE record_id = ?`,
  ).run(
    outcome,
    Date.now(),
    fields.outputPath ?? null,
    fields.error ?? null,
    recordId,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Export queue ops (SQLite-backed — parallel to the render queue; WP-07c)
// ─────────────────────────────────────────────────────────────────────────

export interface EnqueueExportParams {
  exportId: string;
  projectId: string;
  options: unknown;
}

export function enqueueExport(db: Db, params: EnqueueExportParams): void {
  db.prepare(
    `INSERT INTO export_queue
       (export_id, project_id, options, status, created_at)
       VALUES (?, ?, ?, 'queued', ?)`,
  ).run(
    params.exportId,
    params.projectId,
    JSON.stringify(params.options ?? {}),
    Date.now(),
  );
}

export function listExportQueue(db: Db, projectId?: string): ExportQueueRow[] {
  if (projectId) {
    return db
      .prepare(
        `SELECT * FROM export_queue WHERE project_id = ? ORDER BY created_at DESC`,
      )
      .all(projectId) as ExportQueueRow[];
  }
  return db
    .prepare(`SELECT * FROM export_queue ORDER BY created_at DESC`)
    .all() as ExportQueueRow[];
}

export function getExport(db: Db, exportId: string): ExportQueueRow | undefined {
  return db
    .prepare(`SELECT * FROM export_queue WHERE export_id = ?`)
    .get(exportId) as ExportQueueRow | undefined;
}

export function markExportStarted(db: Db, exportId: string): void {
  db.prepare(
    `UPDATE export_queue SET status = 'running', started_at = ? WHERE export_id = ?`,
  ).run(Date.now(), exportId);
}

export function markExportDone(
  db: Db,
  exportId: string,
  outcome: 'done' | 'failed' | 'cancelled',
  fields: { outputPath?: string; error?: string } = {},
): void {
  db.prepare(
    `UPDATE export_queue
        SET status = ?, finished_at = ?, output_path = ?, error = ?
      WHERE export_id = ?`,
  ).run(
    outcome,
    Date.now(),
    fields.outputPath ?? null,
    fields.error ?? null,
    exportId,
  );
}
