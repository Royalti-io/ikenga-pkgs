/**
 * etl.ts — SQLite writer for the local-store-etl sidecar.
 *
 * Uses bun:sqlite (Bun's built-in SQLite driver) to upsert rows from a
 * FixtureDataset into pa.db. All writes use INSERT OR REPLACE for
 * idempotency — re-running is a no-op when the row already exists unchanged.
 *
 * Wave 4 will extend this with a `extractLive(supabaseUrl, serviceRoleKey)`
 * function that fetches live rows from Supabase. The writer path remains the
 * same regardless of source.
 */

import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import type { FixtureDataset, FixtureRow, TableResult } from './types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function rowsChecksum(rows: FixtureRow[]): string {
  const stable = JSON.stringify(
    rows.map((r) => {
      const sorted: FixtureRow = {};
      for (const k of Object.keys(r).sort()) {
        sorted[k] = r[k] ?? null;
      }
      return sorted;
    }),
  );
  return createHash('sha256').update(stable).digest('hex');
}

function buildUpsert(table: string, row: FixtureRow): string {
  const cols = Object.keys(row)
    .map((c) => `"${c}"`)
    .join(', ');
  const placeholders = Object.keys(row)
    .map(() => '?')
    .join(', ');
  return `INSERT OR REPLACE INTO "${table}" (${cols}) VALUES (${placeholders})`;
}

function stableJson(row: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(row).sort()) {
    sorted[k] = row[k] ?? null;
  }
  return JSON.stringify(sorted);
}

function isRowIdentical(
  db: Database,
  table: string,
  row: FixtureRow,
): boolean {
  const id = String(row['id']);
  const sel = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`);
  const existing = sel.get(id) as Record<string, unknown> | null;
  sel.finalize();
  if (existing === null) return false;
  const relevant: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    relevant[k] = existing[k] ?? null;
  }
  return stableJson(relevant) === stableJson(row);
}

function rowValues(row: FixtureRow): (string | number | boolean | null)[] {
  return Object.values(row).map((v) => v ?? null);
}

// ── public API ────────────────────────────────────────────────────────────────

export interface WriteOptions {
  db_path: string;
  dataset: FixtureDataset;
  tables?: string[];
  dry_run?: boolean;
}

export function writeDataset(opts: WriteOptions): TableResult[] {
  const { db_path, dataset, tables: filter, dry_run = false } = opts;
  const db = new Database(db_path);

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=OFF');

  const results: TableResult[] = [];

  for (const [table, rows] of Object.entries(dataset)) {
    if (filter && filter.length > 0 && !filter.includes(table)) continue;
    if (rows.length === 0) {
      results.push({
        table,
        rows_inserted: 0,
        rows_skipped: 0,
        checksum_sha256: rowsChecksum([]),
      });
      continue;
    }

    let inserted = 0;
    let skipped = 0;

    if (!dry_run) {
      const tx = db.transaction(() => {
        for (const row of rows) {
          if (isRowIdentical(db, table, row)) {
            skipped++;
          } else {
            const sql = buildUpsert(table, row);
            const stmt = db.prepare(sql);
            stmt.run(...rowValues(row));
            stmt.finalize();
            inserted++;
          }
        }
      });
      try {
        tx();
      } catch (err) {
        // Table may not exist yet in this db file; skip and report.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[etl] WARN table "${table}" skipped: ${msg}`);
        skipped = rows.length;
      }
    } else {
      skipped = rows.length;
    }

    results.push({
      table,
      rows_inserted: inserted,
      rows_skipped: skipped,
      checksum_sha256: rowsChecksum(rows),
    });
  }

  db.close();
  return results;
}
