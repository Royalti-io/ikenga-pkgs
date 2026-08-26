// com.ikenga.studio project sidecar · canvas.ts + storyboard.reorderCells (G-76)
//
//   bun run src/canvas.test.ts   (from sidecars/project/)
//   bun run test                  (package script — runs this + the others)
//
// Plain assert-based script (no bun:test / node:test import) — same rationale
// as storyboard.test.ts / registry.test.ts: this file typechecks under the
// shared `tsc -p ../../tsconfig.json` project, which has no Bun types, while
// still running for real under the bun runtime.
//
// G-76 #1 — Plan 25 locks authored canvas state (positions, groups, collapse,
// viewport) to `<project>/.studio/canvas.json`, watched, so an arrangement made
// on one machine shows up on another. WP-29 shipped it to browser localStorage
// instead and added `.studio/**` to WATCH_GLOBS with nothing ever writing there,
// which made the watcher wiring look implemented while being dead.
//
// What this proves, through the REAL watcher (not a stub):
//   1. a project that was never arranged reads back `exists:false` — a normal
//      state, not an error, and NOT an empty document that a later save would
//      write over the real one;
//   2. write → read round-trips every authored field;
//   3. the save fires EXACTLY ONE cells/changed. Two would mean the tmp file
//      landed inside the watched `.studio/` directory (it must not) or the
//      write wasn't atomic;
//   4. a corrupt canvas.json is an ERROR, not a silent empty document;
//   5. D-25-5's index write (`storyboard.reorderCells`) actually moves ordinals,
//      leaves un-named cells alone, and refuses to touch disk on a no-op.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCanvas, writeCanvas, ensureStudioDir, type CanvasDoc } from './canvas.js';
import { reorderCells } from './storyboard.js';
import { startWatcher } from './watcher.js';
import { TOPIC_CELLS_CHANGED, type EventEnvelope } from './events.js';

const PROJECT_ID = 'proj-g76-fixture';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function cellFixture(uid: string, index: number): Record<string, unknown> {
  return {
    uid,
    beat_id: '',
    rung: '2_hifi',
    index,
    label: uid,
    time: { start: 0, end: 3 },
    frames: { start: 0, end: 90 },
    narration_excerpt: null,
    shot_type: 'unset',
    camera_move: 'unset',
    duration_ms: 3000,
    prompt: '',
    anchors: [],
    renderer: 'auto',
    content_path: `cells/hifi/${uid}/content.html`,
    notes: '',
    reference_layer: [],
    rungs: {
      '0_beat_sheet': { status: 'pending' },
      '1_lofi': { status: 'pending' },
      '2_hifi': { status: 'pending' },
    },
    comments: [],
    approved: false,
    last_edited: new Date().toISOString(),
    renders: [],
    metadata: {},
  };
}

function scaffoldProject(root: string, uids: string[]): void {
  mkdirSync(join(root, 'cells', 'hifi'), { recursive: true });
  for (const uid of uids) mkdirSync(join(root, 'cells', 'hifi', uid), { recursive: true });
  writeFileSync(
    join(root, 'storyboard.json'),
    JSON.stringify(
      {
        schema_version: 1,
        project_id: PROJECT_ID,
        slug: 'g76',
        title: 'G-76 fixture',
        archetype_id: 'ai_short',
        aspect_ratio: '16:9',
        current_rung: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        cells: uids.map((u, i) => cellFixture(u, i)),
        metadata: {},
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function waitForEvents(events: string[], ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    if (events.length > 0 && Date.now() > until - ms / 2) break;
  }
}

async function main(): Promise<number> {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-g76-'));
  const projectRoot = join(tmp, 'project');
  scaffoldProject(projectRoot, ['c1', 'c2', 'c3']);

  console.log('\ncanvas.read on a project that was never arranged');
  test('reports exists:false with a null doc — a state, not an error', () => {
    const r = readCanvas(projectRoot).result as { ok: boolean; exists: boolean; doc: unknown };
    assert.equal(r.ok, true);
    assert.equal(r.exists, false);
    assert.equal(r.doc, null);
  });

  // `.studio/` is created at project open so the watcher (which prunes
  // not-yet-existing targets at watch start) has something to attach to.
  ensureStudioDir(projectRoot);
  const events: string[] = [];
  const handle = await startWatcher(PROJECT_ID, projectRoot, {
    debounceMs: 50,
    writer: (line) => events.push(line),
  });

  try {
    const doc: CanvasDoc = {
      schema_version: 1,
      layout: { c2: { x: 640, y: 40, w: 200, h: 220 } },
      groups: [{ id: 'g1', title: 'Act 1', shotUids: ['c1', 'c3'], collapsed: true }],
      collapsed: ['c1'],
      lane_collapsed: true,
      viewport: { x: -120, y: 40, scale: 0.75 },
      orphans: { 'c-gone': 1_700_000_000_000 },
      updated_at: '',
    };

    console.log('\ncanvas.write → canvas.read');
    const written = writeCanvas(projectRoot, doc).result as {
      ok: boolean; path: string; bytes: number; doc: CanvasDoc;
    };
    test('the write reports ok and lands at <root>/.studio/canvas.json', () => {
      assert.equal(written.ok, true);
      assert.ok(written.path.replace(/\\/g, '/').endsWith('.studio/canvas.json'));
      assert.ok(written.bytes > 0);
      assert.ok(existsSync(join(projectRoot, '.studio', 'canvas.json')));
    });

    test('updated_at is stamped by the sidecar, not trusted from the caller', () => {
      assert.notEqual(written.doc.updated_at, '');
    });

    test('no scratch file is left inside the watched .studio/ directory', () => {
      const entries = readdirSync(join(projectRoot, '.studio'));
      assert.deepEqual(entries, ['canvas.json']);
    });

    test('every authored field round-trips through a fresh read', () => {
      const r = readCanvas(projectRoot).result as { ok: boolean; exists: boolean; doc: CanvasDoc };
      assert.equal(r.ok, true);
      assert.equal(r.exists, true);
      assert.deepEqual(r.doc.layout, doc.layout);
      assert.deepEqual(r.doc.groups, doc.groups);
      assert.deepEqual(r.doc.collapsed, doc.collapsed);
      assert.equal(r.doc.lane_collapsed, true);
      assert.deepEqual(r.doc.viewport, doc.viewport);
      assert.deepEqual(r.doc.orphans, doc.orphans);
    });

    test('storyboard.json is untouched — layout never leaks into the agent-owned doc', () => {
      const sb = JSON.parse(readFileSync(join(projectRoot, 'storyboard.json'), 'utf8')) as Record<string, unknown>;
      assert.equal(sb.layout, undefined);
      assert.equal((sb.metadata as Record<string, unknown>).layout, undefined);
    });

    test('an invalid document is REFUSED rather than silently normalised', () => {
      const bad = writeCanvas(projectRoot, { schema_version: 1, layout: { c1: { x: 'nope' } } }) as {
        result: { ok: boolean; error?: string };
      };
      assert.equal(bad.result.ok, false);
      assert.equal(bad.result.error, 'invalid-args');
    });

    await waitForEvents(events, 1500);

    test('exactly one cells/changed fired for the save (atomic; tmp lives outside .studio/)', () => {
      assert.equal(events.length, 1, `expected 1 event, got ${events.length}:\n${events.join('\n')}`);
      const env = JSON.parse(events[0]!) as EventEnvelope;
      assert.equal(env.params.topic, TOPIC_CELLS_CHANGED);
      assert.equal(env.params.projectId, PROJECT_ID);
      const payload = env.params.payload as { path: string };
      assert.ok(payload.path.replace(/\\/g, '/').endsWith('.studio/canvas.json'));
    });
  } finally {
    await handle.close();
  }

  console.log('\ncanvas.read on a corrupt canvas.json');
  writeFileSync(join(projectRoot, '.studio', 'canvas.json'), '{ not json', 'utf8');
  test('is an error — never an empty doc a later save would overwrite the real one with', () => {
    const r = readCanvas(projectRoot).result as { ok: boolean; error?: string };
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid-canvas-json');
  });

  console.log('\nstoryboard.reorder_cells (D-25-5 — the lane\'s one sanctioned write)');
  test('reassigns Cell.index to the given order', () => {
    const r = reorderCells(projectRoot, ['c3', 'c1', 'c2']);
    assert.equal((r.result as { ok: boolean }).ok, true);
    assert.equal((r.result as { moved: number }).moved, 3);
    const cells = (r.project!.cells as Array<{ uid: string; index: number }>);
    const byUid = new Map(cells.map((c) => [c.uid, c.index]));
    assert.equal(byUid.get('c3'), 0);
    assert.equal(byUid.get('c1'), 1);
    assert.equal(byUid.get('c2'), 2);
  });

  test('a partial order leaves un-named cells completely alone', () => {
    const before = reorderCells(projectRoot, ['c1', 'c2', 'c3']);
    assert.equal((before.result as { ok: boolean }).ok, true);
    const r = reorderCells(projectRoot, ['c2', 'c1']);
    assert.equal((r.result as { ok: boolean }).ok, true);
    const byUid = new Map(r.project!.cells.map((c) => [c.uid, c.index]));
    assert.equal(byUid.get('c2'), 0);
    assert.equal(byUid.get('c1'), 1);
    assert.equal(byUid.get('c3'), 2, 'c3 was not named and must keep its index');
  });

  test('a no-op order writes NOTHING (no watcher event for a change nobody made)', () => {
    const settled = reorderCells(projectRoot, ['c2', 'c1', 'c3']);
    assert.equal((settled.result as { ok: boolean }).ok, true);
    const again = reorderCells(projectRoot, ['c2', 'c1', 'c3']);
    assert.equal((again.result as { moved: number }).moved, 0);
    assert.equal(again.project, undefined, 'a no-op must not persist');
  });

  test('an unknown uid is refused rather than silently dropped', () => {
    const r = reorderCells(projectRoot, ['c1', 'ghost']);
    assert.equal((r.result as { ok: boolean }).ok, false);
    assert.equal((r.result as { error: string }).error, 'cell-not-found');
  });

  test('duplicate uids are refused (an ambiguous order is not an order)', () => {
    const r = reorderCells(projectRoot, ['c1', 'c1', 'c2']);
    assert.equal((r.result as { ok: boolean }).ok, false);
    assert.equal((r.result as { error: string }).error, 'invalid-args');
  });

  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed`);
  return 0;
}

process.exit(await main());
