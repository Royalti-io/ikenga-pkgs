// com.ikenga.studio project sidecar · G-47 recents registry
//
//   bun run src/recents.test.ts   (from sidecars/project/)
//   bun run test                   (package script — runs this + the others)
//
// Plain assert-based script (no bun:test / node:test import) — same rationale
// as registry.test.ts / session.test.ts / storyboard.test.ts: this file
// typechecks under the shared `tsc -p ../../tsconfig.json` project, which has
// no Bun types, while still running for real under the bun runtime.
//
// WP-13 gate closer — proves the `project.recents` RPC's underlying logic
// (recordProjectMeta write + listRecentProjects read) at the same level
// index.ts's handlers call it: open a fixture project → recents contains it
// with the cheap archetype/cell-count/aspect fields recorded at open time;
// a path that no longer resolves on disk is filtered OUT entirely (not
// flagged, unlike project.list's ProjectSummary).
//
// `better-sqlite3` is a native module absent on toolchain-less machines, so —
// same as session.test.ts — the DB is opened through the injectable
// `DbDriver` with `bun:sqlite` (API-compatible for the exec/prepare surface
// these modules use). Schema + migrations + recents.ts logic under test are
// the shipping ones; only the SQLite binding differs. Everything here runs
// in ONE process against a fresh temp DB — no process-boundary durability is
// being tested (that's session.test.ts's job), so no child re-exec needed.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, type Database, type DbDriver } from './db.js';
import { listRecentProjects, recordProjectMeta } from './recents.js';

async function bunSqliteDriver(): Promise<DbDriver> {
  // Computed specifier: keeps `tsc` from trying to resolve a Bun-only module
  // (same trick session.test.ts uses).
  const spec = 'bun' + ':sqlite';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(spec);
  const Ctor = mod.Database;
  return (dbPath: string) => new Ctor(dbPath) as Database;
}

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main(): Promise<number> {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-g47-'));
  const dbPath = join(tmp, 'studio.db');
  const db = await openDb(dbPath, await bunSqliteDriver());

  // Two fixture project roots — one stays on disk for the whole test, one
  // gets deleted after being recorded, to exercise the "nonexistent paths
  // filtered" behavior.
  const liveRoot = join(tmp, 'fixture-live');
  const deadRoot = join(tmp, 'fixture-dead');
  mkdirSync(liveRoot, { recursive: true });
  mkdirSync(deadRoot, { recursive: true });

  try {
    // ── Phase 1: "open" the live fixture — mirrors index.ts's
    // recordProjectMeta(db, openedProject) call after project.open's trust
    // gate + readProjectFromDisk succeed.
    recordProjectMeta(db, {
      projectId: 'proj-live',
      path: liveRoot,
      name: 'Live Fixture',
      archetypeId: 'explainer',
      cellCount: 7,
      aspect: '16:9',
      now: 1_000,
    });

    test('a fixture recorded on open appears in recents with its cheap fields', () => {
      const rows = listRecentProjects(db);
      assert.equal(rows.length, 1);
      const row = rows[0]!;
      assert.equal(row.projectId, 'proj-live');
      assert.equal(row.path, liveRoot);
      assert.equal(row.name, 'Live Fixture');
      assert.equal(row.lastOpened, 1_000);
      assert.equal(row.archetypeId, 'explainer');
      assert.equal(row.cellCount, 7);
      assert.equal(row.aspect, '16:9');
      assert.equal(row.exists, true);
    });

    // ── Phase 2: "open" a second fixture, then delete its folder out from
    // under the registry — the same shape as a project moved/removed after
    // it was last opened.
    recordProjectMeta(db, {
      projectId: 'proj-dead',
      path: deadRoot,
      name: 'Dead Fixture',
      archetypeId: 'tutorial',
      cellCount: 3,
      aspect: '9:16',
      now: 2_000, // more recent than the live fixture
    });
    rmSync(deadRoot, { recursive: true, force: true });

    test('a project whose folder no longer resolves is filtered out, not flagged', () => {
      const rows = listRecentProjects(db);
      assert.equal(rows.length, 1, 'the dead row must be absent, not present-with-exists:false');
      assert.equal(rows[0]!.projectId, 'proj-live');
      // Every row this function returns is, by construction, openable.
      assert.ok(rows.every((r) => r.exists === true));
    });

    // ── Phase 3: re-open the live fixture (a real re-open bumps last_opened
    // via the same UPSERT the RPC handler uses) — proves the ledger updates
    // in place rather than duplicating a row per open.
    recordProjectMeta(db, {
      projectId: 'proj-live',
      path: liveRoot,
      name: 'Live Fixture',
      archetypeId: 'explainer',
      cellCount: 9, // grew since the first open
      aspect: '16:9',
      now: 3_000,
    });

    test('re-opening an already-known project updates the row in place, most-recent first', () => {
      const rows = listRecentProjects(db);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.lastOpened, 3_000);
      assert.equal(rows[0]!.cellCount, 9);
    });

    // ── Phase 4: limit is applied AFTER the exists filter, so a dead row
    // sandwiched ahead of live ones doesn't crowd out a real result.
    const liveRoot2 = join(tmp, 'fixture-live-2');
    mkdirSync(liveRoot2, { recursive: true });
    recordProjectMeta(db, {
      projectId: 'proj-live-2',
      path: liveRoot2,
      name: 'Live Fixture 2',
      archetypeId: null,
      cellCount: 0,
      aspect: null,
      now: 4_000, // newest of all three rows recorded so far
    });
    // proj-dead (now: 2_000) still sits in the ledger between proj-live-2
    // (4_000) and proj-live (3_000)... actually 2_000 < 3_000, so order by
    // last_opened DESC is: proj-live-2 (4000), proj-live (3000), proj-dead
    // (2000, but its folder is gone). A limit of 2 must still return BOTH
    // live rows, not stop after proj-live-2 + the (filtered) dead row.
    test('a limit counts only openable rows, never a filtered-out dead one', () => {
      const rows = listRecentProjects(db, { limit: 2 });
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((r) => r.projectId),
        ['proj-live-2', 'proj-live'],
      );
      // null archetype/aspect round-trip honestly (never coerced to a string).
      assert.equal(rows[0]!.archetypeId, null);
      assert.equal(rows[0]!.aspect, null);
    });

    console.log(`\n${passed} passed`);
    return 0;
  } finally {
    db.close();
    // Windows/bun:sqlite can keep the WAL/SHM sidecar files locked past
    // `close()` returning (observed even with fs.rmSync's own maxRetries
    // knob), which would otherwise fail an already-green run on nothing but
    // temp-dir cleanup. Best-effort only — the OS reclaims %TEMP% regardless.
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // ignore — see above
    }
  }
}

process.exit(await main());
