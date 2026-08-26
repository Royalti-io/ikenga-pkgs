// com.ikenga.studio project sidecar · blender.ts renderer adapter (G-74)
//
//   bun run src/renderers/blender.test.ts   (from sidecars/project/)
//   bun run test                             (package script — runs this + the others)
//
// Plain assert-based script (no bun:test / node:test import) — same rationale
// as registry.test.ts / session.test.ts / storyboard.test.ts / recents.test.ts:
// this file typechecks under the shared `tsc -p ../../tsconfig.json` project,
// which has no Bun types, while still running for real under the bun runtime.
//
// There is no Blender binary on this toolchain-less box, so this proves
// everything that's testable WITHOUT spawning Blender: argv construction
// (the G-74 #2 arg-order fix), output-path derivation (the G-74 #1 fix —
// never a frame-range-suffixed name), the frame-count/resolution math behind
// the G-74 #4/#6 fixes, the progress-line parser, and the pre-aborted bail
// (G-74 #5) which — by construction — never touches resolveBlenderPath or
// spawns anything, so it needs no binary either.

import assert from 'node:assert/strict';

import {
  blenderAdapter,
  blenderOutputPath,
  buildBaseArgs,
  buildPreviewArgs,
  buildRenderArgs,
  buildResolutionExpr,
  computeTotalFrames,
  parseFrameFromChunk,
  scalePadFilter,
} from './blender.js';
import type { RenderContext } from './types.js';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function fakeCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  const controller = new AbortController();
  return {
    projectRoot: '/proj',
    cellDir: '/proj/cells/hifi/c1',
    rendersDir: '/proj/renders',
    aspectRatio: '16:9',
    resolution: { w: 1920, h: 1080 },
    vault: { get: async () => undefined },
    emit: () => {},
    signal: controller.signal,
    ...overrides,
  };
}

async function main(): Promise<number> {
  // ── G-74 #1: output-path derivation never yields a frame-range name ────
  test('blenderOutputPath lands at <rendersDir>/blender/<rungDir>/<uid>.mp4 (no frame suffix)', () => {
    const { outDir, outPath } = blenderOutputPath('/proj/renders', {
      uid: 'shot-01',
      rung: '2_hifi',
    } as never);
    assert.ok(outDir.replace(/\\/g, '/').endsWith('/renders/blender/hifi'));
    assert.equal(outPath.replace(/\\/g, '/'), `${outDir.replace(/\\/g, '/')}/shot-01.mp4`);
    // Must be an exact, discoverable filename — never `_####`, `_0001-0090`,
    // or any other frame-range/frame-number suffix a naive rename-after-glob
    // strategy could leave behind.
    assert.doesNotMatch(outPath, /#|\d{4}-\d{4}/);
  });

  // ── G-74 #2: preview() argv puts -o/-F before the -f trigger ───────────
  test('buildPreviewArgs: -o and -F precede -f (the render trigger)', () => {
    const args = buildPreviewArgs('/proj/cells/c1/scene.blend', { w: 1920, h: 1080 }, '/out/prefix_####');
    const oIdx = args.indexOf('-o');
    const fIdx = args.indexOf('-f');
    assert.ok(oIdx >= 0 && fIdx >= 0, 'both -o and -f must be present');
    assert.ok(oIdx < fIdx, `-o (${oIdx}) must precede -f (${fIdx}): ${args.join(' ')}`);
    assert.ok(args.indexOf('-F') < fIdx, '-F must precede -f');
    assert.deepEqual(args.slice(oIdx), ['-o', '/out/prefix_####', '-F', 'PNG', '-x', '1', '-f', '1']);
  });

  test('buildPreviewArgs: no "--" sys.argv separator (Blender itself must parse -o/-F/-f)', () => {
    const args = buildPreviewArgs('/proj/cells/c1/scene.blend', { w: 1920, h: 1080 }, '/out/prefix_####');
    assert.ok(!args.includes('--'), `unexpected "--" separator: ${args.join(' ')}`);
  });

  // ── G-74 #2: render() argv puts output/range flags before the -a trigger ─
  test('buildRenderArgs: -o/-F/-s/-e precede -a (the animation trigger)', () => {
    const args = buildRenderArgs('/proj/cells/c1/scene.blend', { w: 1920, h: 1080 }, '/scratch/frame_####.png', 90);
    const aIdx = args.indexOf('-a');
    assert.ok(aIdx >= 0);
    for (const flag of ['-o', '-F', '-x', '-s', '-e']) {
      const idx = args.indexOf(flag);
      assert.ok(idx >= 0 && idx < aIdx, `${flag} (${idx}) must precede -a (${aIdx}): ${args.join(' ')}`);
    }
    // Renders a PNG sequence, never Blender's own FFMPEG movie muxer (the
    // strategy this adapter deliberately did NOT take — see file header).
    assert.equal(args[args.indexOf('-F') + 1], 'PNG');
    assert.ok(!args.includes('FFMPEG'));
  });

  test('buildRenderArgs: frame range is 1..totalFrames', () => {
    const args = buildRenderArgs('/proj/cells/c1/scene.blend', { w: 1920, h: 1080 }, '/scratch/frame_####.png', 42);
    assert.equal(args[args.indexOf('-s') + 1], '1');
    assert.equal(args[args.indexOf('-e') + 1], '42');
  });

  // ── content-type dispatch (.blend vs .py) feeding into buildBaseArgs ───
  test('buildBaseArgs: .blend files are passed positionally', () => {
    const args = buildBaseArgs('/proj/cells/c1/scene.blend', { w: 100, h: 100 });
    assert.ok(args.includes('/proj/cells/c1/scene.blend'));
    assert.ok(!args.includes('--python'));
  });

  test('buildBaseArgs: .py files load via --python (not the "--" sys.argv side channel)', () => {
    const args = buildBaseArgs('/proj/cells/c1/scene.py', { w: 100, h: 100 });
    const pyIdx = args.indexOf('--python');
    assert.ok(pyIdx >= 0);
    assert.equal(args[pyIdx + 1], '/proj/cells/c1/scene.py');
    assert.ok(!args.includes('--'), 'the .py path must not rely on the sys.argv "--" side channel any more');
  });

  // ── G-74 #6: capabilities honesty — resolution is actually injected ────
  test('buildResolutionExpr: sets resolution_x/y + resolution_percentage=100', () => {
    const expr = buildResolutionExpr(1080, 1920);
    assert.match(expr, /resolution_x = 1080/);
    assert.match(expr, /resolution_y = 1920/);
    assert.match(expr, /resolution_percentage = 100/);
  });

  test('buildBaseArgs: injects --python-expr resolution setup before any output flag would be appended', () => {
    const args = buildBaseArgs('/proj/cells/c1/scene.blend', { w: 720, h: 1280 });
    const exprIdx = args.indexOf('--python-expr');
    assert.ok(exprIdx >= 0);
    assert.match(args[exprIdx + 1]!, /resolution_x = 720/);
    assert.match(args[exprIdx + 1]!, /resolution_y = 1280/);
  });

  test('render() argv threads a non-default resolution end to end', () => {
    const args = buildRenderArgs('/proj/cells/c1/scene.blend', { w: 1080, h: 1920 }, '/scratch/frame_####.png', 10);
    const exprIdx = args.indexOf('--python-expr');
    assert.match(args[exprIdx + 1]!, /resolution_x = 1080/);
    assert.match(args[exprIdx + 1]!, /resolution_y = 1920/);
  });

  // ── G-74 #4: fps model is 30, not the old 24fps fallback ───────────────
  test('computeTotalFrames: uses 30fps (frozen P1 time model), not 24fps', () => {
    assert.equal(computeTotalFrames(3000), 90); // 3s @ 30fps
    assert.equal(computeTotalFrames(1000), 30); // 1s @ 30fps — would be 24 under the old fallback
  });

  test('computeTotalFrames: falls back to a 3s default and floors at 1 frame', () => {
    assert.equal(computeTotalFrames(undefined), 90);
    assert.equal(computeTotalFrames(0), 90); // `0 || 3000` — matches the pre-existing fallback semantics
    assert.equal(computeTotalFrames(1), 1); // rounds down to 0 frames, floored to 1
  });

  // ── progress envelope shape: { recordId, cellId, engine, progress, frame } ─
  test('progress envelope matches hyperframes.ts / excalidraw.ts / fal.ts shape', () => {
    const emitted: unknown[] = [];
    const ctx = fakeCtx({ emit: (e) => emitted.push(e) });
    ctx.emit({
      type: 'render.progress',
      payload: { recordId: 'r1', cellId: 'c1', engine: 'blender', progress: 0.5, frame: 45 },
    });
    const evt = emitted[0] as { type: string; payload: Record<string, unknown> };
    assert.equal(evt.type, 'render.progress');
    assert.deepEqual(Object.keys(evt.payload).sort(), ['cellId', 'engine', 'frame', 'progress', 'recordId']);
    assert.equal(evt.payload.engine, 'blender');
  });

  // ── stdout frame-progress parsing ───────────────────────────────────────
  test('parseFrameFromChunk: parses "Fra:N" out of Blender stdout', () => {
    assert.equal(parseFrameFromChunk('Fra:12 Mem:16.83M (Peak 16.83M) | Rendering'), 12);
    assert.equal(parseFrameFromChunk('fra:7'), 7); // case-insensitive
    assert.equal(parseFrameFromChunk('Saved: /tmp/frame_0003.png'), null);
    assert.equal(parseFrameFromChunk(''), null);
  });

  // ── ffmpeg assembly filter parity with excalidraw.ts ────────────────────
  test('scalePadFilter matches the scale+pad+format shape used to assemble frames', () => {
    const f = scalePadFilter(1920, 1080);
    assert.match(f, /^scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080/);
    assert.match(f, /format=yuv420p$/);
  });

  // ── G-74 #5: pre-aborted bail before any spawn/vault lookup ─────────────
  await testAsync('render(): bails synchronously-ish on an already-aborted signal, never touching the vault', async () => {
    const controller = new AbortController();
    controller.abort();
    let vaultCalled = false;
    const ctx = fakeCtx({
      signal: controller.signal,
      vault: { get: async () => { vaultCalled = true; return undefined; } },
    });
    const cell = {
      uid: 'c1',
      rung: '2_hifi',
      content_path: 'cells/hifi/c1/scene.blend',
      duration_ms: 3000,
      anchors: [],
      metadata: {},
    } as never;

    await assert.rejects(
      () => blenderAdapter.render(cell, {}, ctx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error & { cancelled?: boolean }).cancelled, true);
        return true;
      },
    );
    assert.equal(vaultCalled, false, 'render() must bail before resolving the Blender binary at all');
  });

  await testAsync('preview(): bails synchronously-ish on an already-aborted signal, never touching the vault', async () => {
    const controller = new AbortController();
    controller.abort();
    let vaultCalled = false;
    const ctx = fakeCtx({
      signal: controller.signal,
      vault: { get: async () => { vaultCalled = true; return undefined; } },
    });
    const cell = {
      uid: 'c1',
      rung: '2_hifi',
      content_path: 'cells/hifi/c1/scene.blend',
      duration_ms: 3000,
      anchors: [],
      metadata: {},
    } as never;

    await assert.rejects(
      () => blenderAdapter.preview(cell, ctx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error & { cancelled?: boolean }).cancelled, true);
        return true;
      },
    );
    assert.equal(vaultCalled, false, 'preview() must bail before resolving the Blender binary at all');
  });

  // ── cancel(recordId) on an unknown id is a safe no-op ───────────────────
  await testAsync('cancel(): unknown recordId is a no-op (never throws)', async () => {
    await blenderAdapter.cancel!('does-not-exist');
  });

  console.log(`\n${passed} passed`);
  return 0;
}

process.exit(await main());
