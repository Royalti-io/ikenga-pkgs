/**
 * test-wp03.ts — WP-03 smoke-test: runs writeDataset(fixture()) twice
 * against a temp pa.db bootstrapped from the shell migrations, then asserts:
 *   1. First run: rows_inserted > 0 for every non-empty table.
 *   2. Second run: is_no_op === true (idempotency).
 *
 * Run with:  bun src/test-wp03.ts
 */

import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeDataset } from './etl.js';
import { fixture } from './fixture.js';

const MIGRATIONS_DIR = join(
  import.meta.dir,
  '../../../../../shell/src-tauri/migrations',
);

// ── 1. Bootstrap schema into a temp pa.db ─────────────────────────────────

const tmp = mkdtempSync(join(tmpdir(), 'wp03-'));
const dbPath = join(tmp, 'pa.db');

const db = new Database(dbPath);
db.run('PRAGMA journal_mode=WAL');
db.run('PRAGMA foreign_keys=OFF');

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const f of migrationFiles) {
  const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
  db.exec(sql);
}
db.close();

console.log(`[wp03] Schema applied: ${migrationFiles.length} migration files`);
console.log(`[wp03] DB: ${dbPath}`);

// ── 2. First run ────────────────────────────────────────────────────────────

const dataset = fixture();
const tables1 = Object.keys(dataset);
console.log(`[wp03] Tables in fixture: ${tables1.length}`);

const run1 = writeDataset({ db_path: dbPath, dataset });
const inserted1 = run1.reduce((s, t) => s + t.rows_inserted, 0);
const skipped1 = run1.reduce((s, t) => s + t.rows_skipped, 0);
const is_no_op1 = run1.every((t) => t.rows_inserted === 0);

console.log(
  `[wp03] Run 1: inserted=${inserted1}, skipped=${skipped1}, is_no_op=${is_no_op1}`,
);

for (const t of run1) {
  if (t.rows_inserted === 0 && t.rows_skipped === 0) continue;
  console.log(
    `  ${t.table}: inserted=${t.rows_inserted} skipped=${t.rows_skipped}`,
  );
}

// ── 3. Second run (idempotency) ────────────────────────────────────────────

const run2 = writeDataset({ db_path: dbPath, dataset });
const inserted2 = run2.reduce((s, t) => s + t.rows_inserted, 0);
const skipped2 = run2.reduce((s, t) => s + t.rows_skipped, 0);
const is_no_op2 = run2.every((t) => t.rows_inserted === 0);

console.log(
  `[wp03] Run 2: inserted=${inserted2}, skipped=${skipped2}, is_no_op=${is_no_op2}`,
);

// ── 4. Assertions ──────────────────────────────────────────────────────────

let pass = true;

if (is_no_op1) {
  console.error('[FAIL] Run 1 should have inserted rows but was a no-op');
  pass = false;
} else {
  console.log('[PASS] Run 1 inserted rows');
}

if (skipped1 !== 0) {
  console.error(
    `[FAIL] Run 1 had ${skipped1} skipped rows — fixture data does not match real schema`,
  );
  for (const t of run1.filter((t) => t.rows_skipped > 0)) {
    console.error(`  ${t.table}: skipped=${t.rows_skipped}`);
  }
  pass = false;
} else {
  console.log('[PASS] Run 1 skipped 0 rows (all tables matched schema)');
}

if (!is_no_op2) {
  console.error('[FAIL] Run 2 should be a no-op but still inserted rows');
  for (const t of run2.filter((t) => t.rows_inserted > 0)) {
    console.error(`  ${t.table}: inserted=${t.rows_inserted}`);
  }
  pass = false;
} else {
  console.log('[PASS] Run 2 is a no-op (idempotent)');
}

// Run 2 skipped rows are expected (idempotency: row already exists, identical).
// Only an unexpected insert would indicate a real problem, already checked above.

// ── 5. Cleanup ─────────────────────────────────────────────────────────────

rmSync(tmp, { recursive: true });

if (!pass) {
  process.exit(1);
}
console.log('[wp03] ALL ASSERTIONS PASSED');
