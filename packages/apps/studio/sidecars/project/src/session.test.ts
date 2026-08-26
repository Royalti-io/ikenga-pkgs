// com.ikenga.studio project sidecar · G-50 open-project session durability
//
//   bun run src/session.test.ts   (from sidecars/project/)
//   bun run test                   (package script — runs this + registry)
//
// WP-32 DoD 8 / G-50 — "open-project state survives a sidecar respawn".
//
// ── How the respawn is simulated ─────────────────────────────────────────
//
// The state has to survive a *process* boundary, not just a `db.close()`, so
// this test re-execs ITSELF as a short-lived child for each phase. Each child
// opens `studio.db` from scratch through the real `openDb()` (real PRAGMAs,
// real MIGRATIONS), does one thing, and exits. The parent asserts on what the
// NEXT child can see. A child that exits with the project still recorded open
// is exactly a sidecar that was killed mid-session.
//
// ── Why a driver is injected ─────────────────────────────────────────────
//
// `better-sqlite3` is a native module and its prebuilt binding is absent on
// toolchain-less machines (and unbuildable there), which would make this test
// unrunnable for the exact scenario it guards. `openDb()` therefore takes an
// optional `DbDriver`; the children pass `bun:sqlite`, which is API-compatible
// for the `exec` / `prepare().run|get|all` surface these modules use. The
// schema, the migrations and the session logic under test are the shipping
// ones — only the SQLite binding differs.
//
// `bun:sqlite` is imported through a computed specifier so this file still
// typechecks under the shared `tsc -p ../../tsconfig.json` project, which has
// no Bun types (same constraint registry.test.ts documents).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, type Database, type DbDriver } from './db.js';
import {
  buildLastOpen,
  markProjectClosed,
  recordProjectOpened,
  trustSourceFromEnv,
  type LastOpenEntry,
} from './session.js';

const SELF = fileURLToPath(import.meta.url);
const PROJECT_ID = 'proj-g50-fixture';

// ─────────────────────────────────────────────────────────────────────────
// Child phases — each runs in its own process
// ─────────────────────────────────────────────────────────────────────────

async function bunSqliteDriver(): Promise<DbDriver> {
  // Computed specifier: keeps `tsc` from trying to resolve a Bun-only module.
  const spec = 'bun' + ':sqlite';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(spec);
  const Ctor = mod.Database;
  return (dbPath: string) => new Ctor(dbPath) as Database;
}

/** Seed the `projects` recents row the way index.ts's `recordProjectMeta` does. */
function seedProjectMeta(db: Database, path: string, name: string): void {
  db.prepare(
    `INSERT INTO projects (project_id, path, name, last_opened)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE
         SET path = excluded.path, name = excluded.name,
             last_opened = excluded.last_opened`,
  ).run(PROJECT_ID, path, name, Date.now());
}

async function runChild(phase: string, dbPath: string, projectRoot: string): Promise<number> {
  const db = await openDb(dbPath, await bunSqliteDriver());
  try {
    switch (phase) {
      case 'open': {
        seedProjectMeta(db, projectRoot, 'G50 Fixture');
        // Mirrors index.ts's post-trust-gate call exactly, env-derived source
        // included — the child is spawned with STUDIO_TRUST_STUB=1 or not.
        recordProjectOpened(db, {
          projectId: PROJECT_ID,
          path: projectRoot,
          trustSource: trustSourceFromEnv(),
        });
        break;
      }
      case 'close': {
        markProjectClosed(db, PROJECT_ID);
        break;
      }
      case 'inspect': {
        process.stdout.write(JSON.stringify(buildLastOpen(db)) + '\n');
        break;
      }
      default:
        process.stderr.write(`unknown phase: ${phase}\n`);
        return 1;
    }
    return 0;
  } finally {
    db.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Parent harness
// ─────────────────────────────────────────────────────────────────────────

interface ChildResult {
  status: number;
  stdout: string;
  stderr: string;
}

function spawnPhase(
  phase: string,
  dbPath: string,
  projectRoot: string,
  env: Record<string, string>,
): ChildResult {
  const res = spawnSync(
    process.execPath,
    ['run', SELF, '--child', phase, dbPath, projectRoot],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/** Run a phase in a fresh process and fail loudly if it didn't exit clean. */
function phase(
  name: string,
  dbPath: string,
  projectRoot: string,
  env: Record<string, string> = {},
): ChildResult {
  const r = spawnPhase(name, dbPath, projectRoot, env);
  if (r.status !== 0) {
    throw new Error(`child phase "${name}" exited ${r.status}\nstderr:\n${r.stderr}`);
  }
  return r;
}

function inspect(dbPath: string, projectRoot: string): LastOpenEntry[] {
  const r = phase('inspect', dbPath, projectRoot);
  const line = r.stdout.trim().split('\n').filter(Boolean).pop();
  assert.ok(line, `inspect child produced no stdout\nstderr:\n${r.stderr}`);
  return JSON.parse(line) as LastOpenEntry[];
}

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function only(entries: LastOpenEntry[]): LastOpenEntry {
  assert.equal(entries.length, 1, `expected exactly one session, got ${entries.length}`);
  return entries[0]!;
}

async function main(): Promise<number> {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-g50-'));
  const dbPath = join(tmp, 'studio.db');
  const projectRoot = join(tmp, 'fixture-project');

  // Minimal on-disk fixture — session.ts only ever `existsSync`es the root, but
  // a real project root keeps the `missing` case honest when we delete it.
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(
    join(projectRoot, 'storyboard.json'),
    JSON.stringify({ schema_version: 1, slug: 'fixture-project', title: 'G50 Fixture' }) + '\n',
    'utf8',
  );

  try {
    // ── Phase 1: a sidecar opens the project under the trust stub, then dies
    // without ever receiving `project.close`.
    phase('open', dbPath, projectRoot, { STUDIO_TRUST_STUB: '1' });

    test('the open survives into a brand-new process', () => {
      const e = only(inspect(dbPath, projectRoot));
      assert.equal(e.projectId, PROJECT_ID);
      assert.equal(e.path, projectRoot);
      // Joined out of the `projects` recents table, not stored twice.
      assert.equal(e.name, 'G50 Fixture');
      assert.equal(e.exists, true);
    });

    test('a session never closed is flagged as open-at-exit (the reopen candidate)', () => {
      assert.equal(only(inspect(dbPath, projectRoot)).wasOpenAtExit, true);
    });

    test('a STUDIO_TRUST_STUB grant is NOT recorded as durable trust', () => {
      // The whole point of `trust_source`: a stub-mode session must not be
      // able to hand a later production boot a "this folder is trusted" claim.
      const e = only(inspect(dbPath, projectRoot));
      assert.equal(e.trustRecorded, false);
      assert.equal(e.reopen, 'needs-trust');
    });

    // ── Phase 2: reopen with the stub OFF — a real host-sourced grant.
    phase('open', dbPath, projectRoot, { STUDIO_TRUST_STUB: '0' });

    test('a host-sourced grant upgrades the reopen disposition to ready', () => {
      const e = only(inspect(dbPath, projectRoot));
      assert.equal(e.trustRecorded, true);
      assert.equal(e.reopen, 'ready');
      assert.equal(e.wasOpenAtExit, true);
    });

    // ── Phase 3: reopening under the stub again must DOWNGRADE, never keep
    // the stale host grant alive.
    phase('open', dbPath, projectRoot, { STUDIO_TRUST_STUB: '1' });

    test('re-opening under the stub downgrades a previously-recorded host grant', () => {
      const e = only(inspect(dbPath, projectRoot));
      assert.equal(e.trustRecorded, false);
      assert.equal(e.reopen, 'needs-trust');
    });

    // ── Phase 4: an explicit `project.close` retires the candidate.
    phase('close', dbPath, projectRoot);

    test('an explicit close clears open-at-exit but keeps the row', () => {
      const e = only(inspect(dbPath, projectRoot));
      assert.equal(e.wasOpenAtExit, false);
      assert.ok(typeof e.closedAt === 'number' && e.closedAt > 0);
    });

    // ── Phase 5: reopen, then delete the folder out from under us.
    phase('open', dbPath, projectRoot, { STUDIO_TRUST_STUB: '0' });
    rmSync(projectRoot, { recursive: true, force: true });

    test('a project folder that moved/was deleted reports missing, not ready', () => {
      const e = only(inspect(dbPath, projectRoot));
      assert.equal(e.exists, false);
      // `missing` outranks the recorded host grant — never offer a dead path.
      assert.equal(e.trustRecorded, true);
      assert.equal(e.reopen, 'missing');
    });

    console.log(`\n${passed} passed`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const childIdx = argv.indexOf('--child');
if (childIdx >= 0) {
  const [phaseName, dbPath, projectRoot] = argv.slice(childIdx + 1);
  process.exit(await runChild(phaseName!, dbPath!, projectRoot!));
} else {
  process.exit(await main());
}
