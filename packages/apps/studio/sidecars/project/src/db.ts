/**
 * SQLite open + migrations for the render queue.
 *
 * Stored at `$IKENGA_PKG_DATA/studio.db` (falls back to
 * `~/.local/share/ikenga/studio/studio.db` when the env var is unset).
 *
 * Uses better-sqlite3 — synchronous, simple, ESM-friendly prebuilt
 * binaries. The sidecar is single-process and never multi-threads through
 * the queue, so the sync API is the right shape.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Imported lazily so typecheck doesn't require the native module to be
// installed (and so the build script can mark it external).
type Database = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

export interface RenderQueueRow {
  record_id: string;
  project_id: string;
  cell_id: string;
  engine: string;
  options: string; // JSON
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  output_path: string | null;
  error: string | null;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS render_queue (
     record_id   TEXT PRIMARY KEY,
     project_id  TEXT NOT NULL,
     cell_id     TEXT NOT NULL,
     engine      TEXT NOT NULL,
     options     TEXT NOT NULL,
     status      TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
     created_at  INTEGER NOT NULL,
     started_at  INTEGER,
     finished_at INTEGER,
     output_path TEXT,
     error       TEXT
   );
   CREATE INDEX IF NOT EXISTS render_queue_status_idx  ON render_queue(status);
   CREATE INDEX IF NOT EXISTS render_queue_project_idx ON render_queue(project_id);

   CREATE TABLE IF NOT EXISTS projects (
     project_id   TEXT PRIMARY KEY,
     path         TEXT NOT NULL UNIQUE,
     name         TEXT NOT NULL,
     last_opened  INTEGER NOT NULL
   );`,
];

export function resolvePkgDataDir(): string {
  const fromEnv = process.env.IKENGA_PKG_DATA;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // Fallback: ~/.local/share/ikenga/studio
  return join(homedir(), '.local', 'share', 'ikenga', 'studio');
}

export function resolveDbPath(): string {
  return join(resolvePkgDataDir(), 'studio.db');
}

export async function openDb(dbPath?: string): Promise<Database> {
  const target = dbPath ?? resolveDbPath();
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Dynamic import so this module is typecheck-safe even before deps are
  // installed; the bundle externalizes better-sqlite3.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('better-sqlite3');
  const Ctor = mod.default ?? mod;
  const db: Database = new Ctor(target);
  // sane defaults
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const stmt of MIGRATIONS) {
    db.exec(stmt);
  }
  return db;
}

/** For tests / debugging — returns the resolved DB path without opening it. */
export function describeDb(): { pkgDataDir: string; dbPath: string } {
  return { pkgDataDir: resolvePkgDataDir(), dbPath: resolveDbPath() };
}
