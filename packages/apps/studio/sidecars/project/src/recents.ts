/**
 * Recents registry (G-47 / WP-13 gate closer).
 *
 * The `projects` table is the durable "every project this sidecar has ever
 * opened" ledger (distinct from `project_session`, which tracks only the
 * *currently/last* mounted project for G-50's respawn-offer). This module
 * owns the write (on a successful `project.open`) and the read (`project.
 * recents` RPC) for that ledger, pulled out of index.ts so it can be
 * exercised directly without spawning the sidecar process — the same split
 * session.ts already uses for the G-50 open-project state.
 *
 * Cheap fields only: `archetype_id` / `cell_count` / `aspect` come straight
 * off the `Project` the caller already parsed off disk on open — no extra
 * I/O, no re-opening a project just to list it.
 */

import { existsSync } from 'node:fs';

import type { Database } from './db.js';

export interface RecentProject {
  projectId: string;
  path: string;
  name: string;
  lastOpened: number;
  archetypeId: string | null;
  cellCount: number | null;
  aspect: string | null;
  /** Always `true` — `listRecentProjects` filters out paths that no longer
   *  exist on disk rather than flagging them (contrast with `project.list`'s
   *  `ProjectSummary`, which keeps dead rows and marks `exists: false` for
   *  the shell's own Recents UI to dim). */
  exists: true;
}

export interface RecordProjectMetaArgs {
  projectId: string;
  path: string;
  name: string;
  archetypeId: string | null;
  cellCount: number;
  aspect: string | null;
  /** Injectable for deterministic tests. */
  now?: number;
}

/** Upsert the recents row for a successfully-opened project. Called once per
 *  `project.open` (and `project.create`, which opens after scaffolding), so
 *  every real open — the trust gate already passed by the time this runs —
 *  keeps the ledger current. */
export function recordProjectMeta(db: Database, args: RecordProjectMetaArgs): void {
  const now = args.now ?? Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, path, name, last_opened, archetype_id, cell_count, aspect)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE
         SET path         = excluded.path,
             name         = excluded.name,
             last_opened  = excluded.last_opened,
             archetype_id = excluded.archetype_id,
             cell_count   = excluded.cell_count,
             aspect       = excluded.aspect`,
  ).run(args.projectId, args.path, args.name, now, args.archetypeId, args.cellCount, args.aspect);
}

interface ProjectRow {
  project_id: string;
  path: string;
  name: string;
  last_opened: number;
  archetype_id: string | null;
  cell_count: number | null;
  aspect: string | null;
}

/**
 * Read the recents ledger, most-recently-opened first, with paths that no
 * longer resolve on disk filtered OUT entirely (moved/deleted project
 * folders are not openable, so surfacing them as first-class recents would
 * just hand the Launcher a row whose Open click throws — the honesty rule
 * this registry exists to uphold).
 */
export function listRecentProjects(db: Database, opts: { limit?: number } = {}): RecentProject[] {
  const limit = opts.limit ?? 20;
  // No SQL LIMIT here: the exists filter runs AFTER the query, so limiting in
  // SQL first could hand back fewer than `limit` real rows even when more
  // openable projects exist further down the ledger. The table is small
  // (one row per project ever opened) so filter-then-slice in JS is cheap.
  const rows = db
    .prepare(
      `SELECT project_id, path, name, last_opened, archetype_id, cell_count, aspect
         FROM projects
        ORDER BY last_opened DESC`,
    )
    .all() as ProjectRow[];

  return rows
    .filter((row) => existsSync(row.path))
    .slice(0, limit)
    .map((row) => ({
      projectId: row.project_id,
      path: row.path,
      name: row.name,
      lastOpened: row.last_opened,
      archetypeId: row.archetype_id,
      cellCount: row.cell_count,
      aspect: row.aspect,
      exists: true as const,
    }));
}
