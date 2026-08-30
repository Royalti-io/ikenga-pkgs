/**
 * Open-project session state (G-50 / WP-32 DoD 8).
 *
 * The sidecar's open-project registry is an in-memory `Map`. Every sidecar
 * respawn — a crash, a `SIGTERM`, or the dev-reload that happens dozens of
 * times an hour — empties it, and the UI drops back to the Launcher with no
 * memory of what was mounted. This module persists that registry into the
 * existing `studio.db` so a respawned sidecar can *offer* the reopen.
 *
 * ── Why this does NOT auto-reopen ────────────────────────────────────────
 *
 * `project.open` runs the WP-04 trust gate (`requestProjectAccess`) before it
 * touches the filesystem. A boot-time auto-reopen that read a stored row and
 * mounted the folder would be exactly the bypass that gate exists to prevent:
 * the sidecar's DB is a *cache* of a past answer, not the authority. The user
 * can revoke a folder's trust in the shell, and the sidecar would never learn
 * of it.
 *
 * So the contract is: this table is advisory. The sidecar exposes it via the
 * `project.last_open` RPC; the UI (or MCP) decides whether to offer a reopen,
 * and the reopen it performs is an ordinary `project.open` call that re-runs
 * the gate. There is no code path here that mounts a project.
 *
 * `trust_source` exists for the same reason. `STUDIO_TRUST_STUB=1` mints
 * grants for tests and pre-WP-04 dev; recording one as a durable grant would
 * let a stub-mode session smuggle a "trusted" marker into a later production
 * boot. Only a `'host'`-sourced grant sets `trust_granted_at`, and even that
 * only downgrades the reopen prompt's loudness — it never skips the gate.
 */

import { existsSync } from 'node:fs';
import { basename } from 'node:path';

import type { Database } from './db.js';

/** Where a trust grant came from. Only `'host'` is durable. */
export type TrustSource = 'host' | 'stub';

/**
 * How a stored session should be surfaced by the UI. Every disposition still
 * reopens through `project.open` — this only says how much friction to expect.
 *
 *   ready       — path is present and a real host grant is on record; the
 *                 reopen should sail through the gate.
 *   needs-trust — path is present but the only grant on record is stubbed
 *                 (or absent); expect the trust prompt.
 *   missing     — the folder moved or was deleted; do not offer a reopen.
 */
export type ReopenDisposition = 'ready' | 'needs-trust' | 'missing';

export interface LastOpenEntry {
  projectId: string;
  path: string;
  name: string;
  openedAt: number;
  closedAt: number | null;
  /** `true` when the sidecar stopped with this project still mounted. */
  wasOpenAtExit: boolean;
  /** `fs.existsSync(path)` at read time. */
  exists: boolean;
  /** A non-stub trust grant is on record for this path. Advisory only. */
  trustRecorded: boolean;
  reopen: ReopenDisposition;
}

interface SessionRow {
  project_id: string;
  path: string;
  opened_at: number;
  closed_at: number | null;
  trust_granted_at: number | null;
  trust_source: string | null;
  name: string | null;
}

/**
 * Mirrors `trust.ts`'s own branch: with the stub flag set, every grant is
 * synthetic. Shared with the tests so the mapping can't drift.
 */
export function trustSourceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TrustSource {
  return env.STUDIO_TRUST_STUB === '1' ? 'stub' : 'host';
}

export interface RecordOpenedArgs {
  projectId: string;
  path: string;
  trustSource: TrustSource;
  /** Injectable for deterministic tests. */
  now?: number;
}

/**
 * Record that `path` is mounted under `projectId`. Clears any prior
 * `closed_at`, so a reopened project becomes a live session again.
 *
 * A stub-sourced grant explicitly writes `trust_granted_at = NULL`: reopening
 * a folder in stub mode must not *upgrade* — or, if a real grant was recorded
 * earlier, must not silently preserve — a claim we can no longer vouch for.
 */
export function recordProjectOpened(db: Database, args: RecordOpenedArgs): void {
  const now = args.now ?? Date.now();
  const grantedAt = args.trustSource === 'host' ? now : null;

  // The unique index is on `path`, the primary key on `project_id`. They stay
  // in lockstep in practice (index.ts reuses the stored id for a known path),
  // but a project folder copied over another's id would collide, so drop any
  // stale row claiming this path under a different id first.
  db.prepare(`DELETE FROM project_session WHERE path = ? AND project_id <> ?`).run(
    args.path,
    args.projectId,
  );

  db.prepare(
    `INSERT INTO project_session
       (project_id, path, opened_at, closed_at, trust_granted_at, trust_source)
     VALUES (?, ?, ?, NULL, ?, ?)
     ON CONFLICT(project_id) DO UPDATE
       SET path             = excluded.path,
           opened_at        = excluded.opened_at,
           closed_at        = NULL,
           trust_granted_at = excluded.trust_granted_at,
           trust_source     = excluded.trust_source`,
  ).run(args.projectId, args.path, now, grantedAt, args.trustSource);
}

/**
 * Mark a session closed. Called only from the explicit `project.close` RPC —
 * *not* from the shutdown handler, because a project still mounted when the
 * sidecar stops is precisely the one worth offering back.
 */
export function markProjectClosed(db: Database, projectId: string, now = Date.now()): void {
  db.prepare(`UPDATE project_session SET closed_at = ? WHERE project_id = ?`).run(
    now,
    projectId,
  );
}

/** Forget a session entirely (used when a reopen is declined for good). */
export function forgetProjectSession(db: Database, projectId: string): void {
  db.prepare(`DELETE FROM project_session WHERE project_id = ?`).run(projectId);
}

function dispositionOf(row: SessionRow, exists: boolean): ReopenDisposition {
  if (!exists) return 'missing';
  if (row.trust_source === 'host' && row.trust_granted_at !== null) return 'ready';
  return 'needs-trust';
}

/**
 * Read the persisted sessions, newest first, decorated with a live `exists`
 * check and a reopen disposition. Pure read — never mounts anything.
 */
export function buildLastOpen(db: Database, opts: { limit?: number } = {}): LastOpenEntry[] {
  const limit = opts.limit ?? 20;
  const rows = db
    .prepare(
      `SELECT s.project_id, s.path, s.opened_at, s.closed_at,
              s.trust_granted_at, s.trust_source, p.name AS name
         FROM project_session s
         LEFT JOIN projects p ON p.project_id = s.project_id
        ORDER BY s.opened_at DESC
        LIMIT ?`,
    )
    .all(limit) as SessionRow[];

  return rows.map((row) => {
    const exists = existsSync(row.path);
    return {
      projectId: row.project_id,
      path: row.path,
      name: row.name && row.name.length > 0 ? row.name : basename(row.path),
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      wasOpenAtExit: row.closed_at === null,
      exists,
      trustRecorded: row.trust_source === 'host' && row.trust_granted_at !== null,
      reopen: dispositionOf(row, exists),
    };
  });
}
