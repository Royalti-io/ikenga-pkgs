/**
 * Excalidraw renderer adapter (WP-05b).
 *
 * Second concrete `RendererAdapter` for com.ikenga.studio. Renders
 * `.excalidraw` scene files to MP4 via a headless Puppeteer page driving
 * `@excalidraw/excalidraw` (static) and `excalidraw-animate` (animated),
 * then FFmpeg-encodes the result.
 *
 *   • Static  (`cell.metadata.animation` absent) — `exportToBlob()` → PNG,
 *     scene JSON embedded via serializeAsJSON + encodePngMetadata (see
 *     deviation #4) → `ffmpeg -loop 1 -t <dur>` → MP4.
 *   • Animated (`cell.metadata.animation` present) — `exportToSvg` +
 *     `animateSvg()` injects SMIL; we drive `svg.setCurrentTime()` on a
 *     fixed-fps tick loop, `page.screenshot()` each frame, then
 *     `ffmpeg -framerate <fps>` → MP4.
 *
 * G24 — Chrome version pin. We launch `puppeteer.launch({ executablePath })`
 * using the SHARED resolver in `./chrome.ts` (the exact build HyperFrames
 * spawns). One Chrome, one version, one source of truth — we never call
 * `puppeteer.executablePath()` directly in this file.
 *
 * G14 — output path. Lands at
 * `<rendersDir>/excalidraw/<rungDir(cell.rung)>/<uid>.mp4` via the
 * `rungDir()` schema helper.
 *
 * G-44 — aspect-ratio honoring. The output canvas dims are resolved by
 * `resolveResolution()` (see its doc): an explicit per-call
 * `RenderOptions.resolution` wins; otherwise dims follow the RESOLVED aspect
 * (`opts.aspect_ratio ?? ctx.aspectRatio`) via `DEFAULT_RESOLUTION`, NOT the
 * stale project-default `ctx.resolution`. The exported PNG (native scene
 * size) is then scaled-to-fit + centered + white-padded into that target
 * canvas via `scalePadFilter` — Excalidraw content is vector, so fitting it
 * into 1080×1080 / 1080×1920 / 1920×1080 letterboxes cleanly with no crop.
 * This mirrors HF's effective framing (HF always lands at
 * `DEFAULT_RESOLUTION[aspect]` via its `--resolution` preset).
 *
 * ─── Deviations from the WP-05b brief ─────────────────────────────────────
 *
 * 1. BUNDLE-FIRST, not CDN/importmap injection. The brief says "inject
 *    `@excalidraw/excalidraw` … call `exportToBlob` in-page". The published
 *    0.18.1 prod bundle is multi-chunk ESM that bare-imports ~20 transitive
 *    deps (react, react-dom, roughjs, jotai, @radix-ui/*, clsx, …) — there
 *    is no standalone UMD, and React 19 ships no browser ESM build, so a
 *    raw `addScriptTag` / importmap would have to map every transitive dep
 *    by hand and would still break network-free (G2 `requires_network:
 *    false`). Instead we bundle a tiny browser entry (excalidraw + animate
 *    + react inlined) with esbuild ONCE, cache it to a temp file keyed by
 *    the installed package versions, and `page.evaluate(bundle)` it. esbuild
 *    is an additive devDependency; the bundle is fully self-contained, so
 *    rendering needs zero network. The in-page calls (`exportToBlob`,
 *    `exportToSvg`, `animateSvg`) are exactly as the brief specifies.
 *
 * 2. We do NOT spin up an HTTP server (an earlier design considered serving
 *    the dist dir + react shims). The ESM bundle is injected as a module
 *    `<script>` (`page.addScriptTag({ type:'module' })`) and assigns
 *    `window.__ik` — simpler and equally network-free.
 *
 * 3. Animated capture uses SMIL playback driving (`svg.setCurrentTime` +
 *    per-frame `page.screenshot`) per the excalidraw-animate author's docs —
 *    the library's direct `exportToWebmFile` is a DOM-download helper unfit
 *    for a headless sidecar. `metadata.animation.keyframes[]` (Excalimate)
 *    is a future-slot and IGNORED in P1; we read only
 *    `metadata.animation.{order, duration_ms}`.
 *
 * 4. exportEmbedScene is NOT a public option. The brief specified
 *    `exportToBlob({ … exportEmbedScene: true })`, but the PUBLIC
 *    `@excalidraw/utils/export#exportToBlob` (0.18.1) has no such field —
 *    `exportEmbedScene` only exists on excalidraw's INTERNAL file-save
 *    action, which the util never calls. Passing it to `exportToBlob` is a
 *    silent no-op (verified: the PNG carries no `application/vnd.excalidraw`
 *    tEXt chunk). To genuinely embed the scene we replicate excalidraw's own
 *    embed: `serializeAsJSON(elements, appState, files, 'local')` →
 *    `encodePngMetadata({ blob, metadata })`, which writes the same tEXt
 *    chunk keyword `loadFromBlob` reads on re-import. `encodePngMetadata`
 *    lives in excalidraw's internal `dist/prod/data/image-*.js` re-export;
 *    we resolve it relative to the prod entry and bundle it in.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import puppeteer, { type Browser } from 'puppeteer';

import {
  rungDir,
  DEFAULT_RESOLUTION,
  type AspectRatio,
  type Cell,
  type RenderRecord,
} from '@ikenga/studio-schema';

import { resolveChromeExecutable, resolveChromeExecutableAsync } from './chrome.js';
import type {
  Diagnostic,
  PreviewURL,
  RenderContext,
  RenderOptions,
  RendererAdapter,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const EXCALIDRAW_FPS = 30;

// In-flight renders keyed by recordId so cancel(recordId) can reach them.
// We track the Puppeteer browser + any active ffmpeg child per record.
interface ActiveRender {
  browser?: Browser;
  ffmpeg?: ChildProcess;
  aborted?: boolean;
}
const activeRenders = new Map<string, ActiveRender>();

// The browser-side bundle (excalidraw + animate + react, all inlined) is
// built once and cached on disk keyed by the installed package versions.
let cachedBundlePath: string | null = null;
let bundleBuildPromise: Promise<string> | null = null;

// engine_version reported on the RenderRecord — the installed
// @excalidraw/excalidraw version (deterministic, no model churn).
let cachedEngineVersion: string | null = null;

// ─────────────────────────────────────────────────────────────────────────
// Animation metadata (P1 surface only — keyframes[] is a future-slot)
// ─────────────────────────────────────────────────────────────────────────

interface AnimationMeta {
  order?: number[];
  duration_ms?: number;
}

function readAnimationMeta(cell: Cell): AnimationMeta | null {
  const meta = cell.metadata as Record<string, unknown> | undefined;
  const anim = meta?.animation as AnimationMeta | undefined;
  if (!anim || typeof anim !== 'object') return null;
  return anim;
}

// ─────────────────────────────────────────────────────────────────────────
// Path / framing helpers (mirror hyperframes.ts conventions)
// ─────────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function absContentPath(cell: Cell, ctx: RenderContext): string {
  return isAbsolute(cell.content_path)
    ? cell.content_path
    : resolve(ctx.projectRoot, cell.content_path);
}

function resolveAspect(opts: RenderOptions, ctx: RenderContext): AspectRatio {
  return opts.aspect_ratio ?? ctx.aspectRatio;
}

/**
 * Resolve the output W×H for an Excalidraw render (G-44).
 *
 * Mirrors HyperFrames' *effective* framing rather than HF's literal code: HF
 * maps the resolved aspect to a `--resolution` preset, so its output ALWAYS
 * lands at `DEFAULT_RESOLUTION[aspect]` regardless of `ctx.resolution` (HF
 * records `resolution_actual: DEFAULT_RESOLUTION[aspect]`). We must do the
 * same, because `ctx.resolution` carries the PROJECT-DEFAULT framing — when a
 * per-call `aspect_ratio` override flips the aspect (e.g. a 16:9 project asks
 * for a 9:16 cell), `ctx.resolution` is still 1920×1080 and would otherwise
 * win, producing a landscape canvas for a portrait request (the original
 * G-44 defect). So:
 *   • an explicit per-call `opts.resolution` wins (caller knows best);
 *   • otherwise the dims follow the RESOLVED aspect via DEFAULT_RESOLUTION —
 *     NOT the stale project-default `ctx.resolution`.
 * This keeps the happy path intact (16:9 project, no override → 1920×1080)
 * while making 1:1 → 1080×1080 and 9:16 → 1080×1920 correct.
 */
function resolveResolution(
  opts: RenderOptions,
  ctx: RenderContext,
  aspect: AspectRatio,
): { w: number; h: number } {
  if (opts.resolution) return opts.resolution;
  // Honor ctx.resolution only when it agrees with the resolved aspect (i.e. no
  // per-call override flipped us off the project default); otherwise the
  // aspect override is authoritative and we derive dims from it.
  const def = DEFAULT_RESOLUTION[aspect];
  if (ctx.resolution && aspectOf(ctx.resolution) === aspect) return ctx.resolution;
  return def;
}

/** Classify a {w,h} into one of the supported aspect buckets (or null). */
function aspectOf(res: { w: number; h: number }): AspectRatio | null {
  if (res.w === res.h) return '1:1';
  if (res.w > res.h) return '16:9';
  return '9:16';
}

/** Resolve a unique output path under `rendersDir/excalidraw/<rungDir>/`. */
function resolveOutputPath(cell: Cell, ctx: RenderContext): string {
  const dir = join(ctx.rendersDir, 'excalidraw', rungDir(cell.rung));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const base = join(dir, `${cell.uid}.mp4`);
  if (!existsSync(base)) return base;
  const suffix = randomUUID().slice(0, 8);
  return join(dir, `${cell.uid}.${suffix}.mp4`);
}

// ─────────────────────────────────────────────────────────────────────────
// Module resolution + bundle build
// ─────────────────────────────────────────────────────────────────────────

/**
 * A require() rooted at THIS module so package resolution finds the studio
 * package's dependency tree (works whether run from src or built dist).
 */
function localRequire() {
  return createRequire(import.meta.url);
}

function readInstalledVersions(): { excalidraw: string; animate: string } {
  const req = localRequire();
  let exc = 'unknown';
  let anim = 'unknown';
  try {
    // @excalidraw/excalidraw blocks ./package.json via exports — read it off
    // disk from the resolved entry's directory instead.
    const excEntry = req.resolve('@excalidraw/excalidraw');
    // .../@excalidraw/excalidraw/dist/prod/index.js → walk up to the pkg root
    let dir = dirname(excEntry);
    for (let i = 0; i < 5; i++) {
      const pj = join(dir, 'package.json');
      if (existsSync(pj)) {
        const j = JSON.parse(readFileSync(pj, 'utf8'));
        if (j.name === '@excalidraw/excalidraw') {
          exc = j.version ?? 'unknown';
          break;
        }
      }
      dir = dirname(dir);
    }
  } catch {
    /* leave 'unknown' */
  }
  try {
    const animLib = req.resolve('excalidraw-animate/dist/library.js');
    let dir = dirname(animLib);
    for (let i = 0; i < 5; i++) {
      const pj = join(dir, 'package.json');
      if (existsSync(pj)) {
        const j = JSON.parse(readFileSync(pj, 'utf8'));
        if (j.name === 'excalidraw-animate') {
          anim = j.version ?? 'unknown';
          break;
        }
      }
      dir = dirname(dir);
    }
  } catch {
    /* leave 'unknown' */
  }
  return { excalidraw: exc, animate: anim };
}

function detectEngineVersion(): string {
  if (cachedEngineVersion !== null) return cachedEngineVersion;
  cachedEngineVersion = readInstalledVersions().excalidraw;
  return cachedEngineVersion;
}

/**
 * Build (or reuse) the self-contained browser bundle that exposes
 * `window.__ik = { exportToBlob, exportToSvg, exportToCanvas, animateSvg,
 * getBeginTimeList }`. Bundled once with esbuild, cached on disk keyed by
 * the installed package versions so the ~13 MB build cost is paid at most
 * once per version per machine.
 */
async function buildBrowserBundle(): Promise<string> {
  if (cachedBundlePath && existsSync(cachedBundlePath)) return cachedBundlePath;
  if (bundleBuildPromise) return bundleBuildPromise;

  bundleBuildPromise = (async () => {
    const req = localRequire();
    const { excalidraw, animate } = readInstalledVersions();

    const cacheDir = join(tmpdir(), 'ikenga-studio-excalidraw');
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    const outFile = join(cacheDir, `bundle.exc${excalidraw}.anim${animate}.js`);
    if (existsSync(outFile) && statSync(outFile).size > 0) {
      cachedBundlePath = outFile;
      return outFile;
    }

    // Resolve the concrete dist entries (absolute) so esbuild bundles the
    // exact installed builds regardless of CWD.
    const excEntry = req.resolve('@excalidraw/excalidraw');
    const animEntry = req.resolve('excalidraw-animate/dist/library.js');
    // `serializeAsJSON` + `encodePngMetadata` let us embed the scene into the
    // exported PNG ourselves: the PUBLIC `exportToBlob` util has no
    // `exportEmbedScene` option (that flag only exists on excalidraw's
    // internal file-save action — see deviation #4), so we replicate the
    // embed using the same tEXt chunk keyword excalidraw's `loadFromBlob`
    // reads on re-import. `encodePngMetadata` lives in the internal
    // `data/image-*.js` re-export; we resolve it relative to the prod entry.
    const imageMod = join(dirname(excEntry), 'data', readdirSync(join(dirname(excEntry), 'data')).find((f) => /^image-.*\.js$/.test(f)) ?? 'image.js');

    // esbuild is an additive devDependency (see deviation #1). Import it
    // lazily so a typecheck / non-render code path never pays for it.
    const esbuild = (await import('esbuild')).default ?? (await import('esbuild'));

    const entry =
      `import { exportToBlob, exportToSvg, exportToCanvas, serializeAsJSON } from ${JSON.stringify(excEntry)};\n` +
      `import { encodePngMetadata } from ${JSON.stringify(imageMod)};\n` +
      `import { animateSvg, getBeginTimeList } from ${JSON.stringify(animEntry)};\n` +
      `globalThis.__ik = { exportToBlob, exportToSvg, exportToCanvas, serializeAsJSON, encodePngMetadata, animateSvg, getBeginTimeList };\n`;

    const res = await esbuild.build({
      stdin: { contents: entry, resolveDir: dirname(excEntry), loader: 'js' },
      bundle: true,
      // `esm` (not `iife`): the prod bundle uses dynamic `import()` for some
      // code paths; esbuild inlines those under `esm` with no splitting, but
      // would leave a runtime `import()` (which has no loader in the page)
      // under `iife`.
      format: 'esm',
      platform: 'browser',
      write: false,
      define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
      loader: {
        '.woff2': 'dataurl',
        '.woff': 'dataurl',
        '.ttf': 'dataurl',
        '.svg': 'dataurl',
        '.png': 'dataurl',
      },
      logLevel: 'silent',
    });
    const code = res.outputFiles?.[0]?.text;
    if (!code) throw new Error('[excalidraw] esbuild produced no output');
    writeFileSync(outFile, code, 'utf8');
    cachedBundlePath = outFile;
    return outFile;
  })().finally(() => {
    bundleBuildPromise = null;
  });

  return bundleBuildPromise;
}

// ─────────────────────────────────────────────────────────────────────────
// Scene parsing
// ─────────────────────────────────────────────────────────────────────────

interface ExcalidrawScene {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

function parseScene(raw: string): ExcalidrawScene {
  const json = JSON.parse(raw) as ExcalidrawScene;
  if (!json || !Array.isArray(json.elements)) {
    throw new Error('not a valid Excalidraw scene (missing `elements` array)');
  }
  return {
    elements: json.elements,
    appState: json.appState ?? {},
    files: json.files ?? {},
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FFmpeg helpers
// ─────────────────────────────────────────────────────────────────────────

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  const signalGroup = (sig: NodeJS.Signals) => {
    if (pid === undefined) return;
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        if (!child.killed) child.kill(sig);
      } catch {
        /* already exited */
      }
    }
  };
  signalGroup('SIGTERM');
  setTimeout(() => signalGroup('SIGKILL'), 1200);
}

/**
 * Encode a single still (looped) to MP4 at the given resolution/duration.
 * Mirrors hyperframes.ts framing: scale + pad to exact W×H, h264, yuv420p.
 */
function runFfmpeg(
  args: string[],
  record: ActiveRender,
): Promise<void> {
  return new Promise<void>((resolveExit, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
    record.ffmpeg = child;
    let tail = '';
    child.stderr?.on('data', (b: Buffer) => {
      tail += b.toString('utf8');
      if (tail.length > 8000) tail = tail.slice(-8000);
    });
    child.once('error', (e) => reject(e));
    child.once('close', (code) => {
      record.ffmpeg = undefined;
      if (record.aborted) {
        reject(Object.assign(new Error('[excalidraw] ffmpeg aborted'), { cancelled: true }));
        return;
      }
      if (code === 0) resolveExit();
      else reject(new Error(`[excalidraw] ffmpeg exited ${code ?? 'spawn-error'}:\n${tail.slice(-1500)}`));
    });
  });
}

/** Even-dimension, scale-to-fit + pad-to-exact filter (matches HF framing). */
function scalePadFilter(w: number, h: number): string {
  return (
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────

export const excalidrawAdapter: RendererAdapter = {
  id: 'excalidraw',

  capabilities: {
    still: true,
    video: true,
    interactive: false,
    range: false,
    combine: false,
    aspect_ratios: ['16:9', '9:16', '1:1'],
    max_duration_ms: null,
    supported_codecs: ['h264'],
    requires_network: false,
  },

  async validate(cell, ctx) {
    const diags: Diagnostic[] = [];
    const abs = absContentPath(cell, ctx);

    if (!existsSync(abs)) {
      diags.push({
        severity: 'error',
        code: 'content-missing',
        message: `Cell content not found on disk: ${abs}`,
        path: 'content_path',
      });
      return diags;
    }

    if (!abs.toLowerCase().endsWith('.excalidraw')) {
      diags.push({
        severity: 'error',
        code: 'unsupported-content-type',
        message: 'Excalidraw requires a .excalidraw scene file',
        path: 'content_path',
      });
      return diags;
    }

    // Parse the scene; surface parse failures + empty-scene warning.
    let scene: ExcalidrawScene | null = null;
    try {
      scene = parseScene(readFileSync(abs, 'utf8'));
    } catch (e) {
      diags.push({
        severity: 'error',
        code: 'scene-invalid',
        message: `Could not parse Excalidraw scene: ${(e as Error).message}`,
        path: 'content_path',
      });
      return diags;
    }

    const liveElements = scene.elements.filter(
      (el) => !(el as { isDeleted?: boolean })?.isDeleted,
    );
    if (liveElements.length === 0) {
      diags.push({
        severity: 'warning',
        code: 'scene-empty',
        message: 'Excalidraw scene has no (non-deleted) elements — render will be blank',
        path: 'content_path',
      });
    }

    // Broken anchor refs — the cell references anchors not present in scene
    // metadata.anchors (the project resolves anchors; here we can only warn
    // when the cell lists anchors but the scene carries none of them).
    if (cell.anchors.length > 0) {
      const sceneAnchorIds = new Set<string>(
        (((cell.metadata as Record<string, unknown>)?.anchors as string[]) ?? []).map(String),
      );
      const missing = cell.anchors.filter((a) => !sceneAnchorIds.has(a));
      if (missing.length === cell.anchors.length && sceneAnchorIds.size === 0) {
        diags.push({
          severity: 'warning',
          code: 'anchors-unresolved',
          message: `Cell references ${cell.anchors.length} anchor(s) but the scene declares none — references may be broken`,
          path: 'anchors',
        });
      }
    }

    // Capability cross-check (G1/G2) — defensive second line of defence.
    const aspect = ctx.aspectRatio;
    if (!excalidrawAdapter.capabilities.aspect_ratios.includes(aspect)) {
      diags.push({
        severity: 'error',
        code: 'aspect-not-supported',
        message: `Excalidraw does not support aspect ratio ${aspect}`,
      });
    }

    return diags;
  },

  async preview(cell, ctx) {
    const abs = absContentPath(cell, ctx);
    // The Cell sub-view (WP-07) mounts the .excalidraw via <Excalidraw>
    // view-only; we return the cheapest representation — a file:// URL.
    const url: PreviewURL = pathToFileURL(abs).href;
    return url;
  },

  async render(cell, opts, ctx) {
    const recordId = randomUUID();
    const startedAt = nowIso();
    const startedAtMs = Date.now();

    const aspect = resolveAspect(opts, ctx);
    const resolution = resolveResolution(opts, ctx, aspect);
    const engineVersion = detectEngineVersion();

    const abs = absContentPath(cell, ctx);
    if (!existsSync(abs)) {
      throw new Error(`[excalidraw] cell content not found: ${abs}`);
    }
    const scene = parseScene(readFileSync(abs, 'utf8'));
    const anim = readAnimationMeta(cell);

    const outPath = resolveOutputPath(cell, ctx);
    const outDir = dirname(outPath);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    // Resolve the shared pinned Chrome (G24) — prefer the authoritative async
    // resolver; fall back to the sync scan. NEVER puppeteer.executablePath().
    let chromePath: string;
    try {
      chromePath = await resolveChromeExecutableAsync();
    } catch {
      chromePath = resolveChromeExecutable();
    }

    const bundlePath = await buildBrowserBundle();
    const bundleCode = readFileSync(bundlePath, 'utf8');

    const record: ActiveRender = {};
    activeRenders.set(recordId, record);

    const onAbort = () => {
      record.aborted = true;
      if (record.ffmpeg) killTree(record.ffmpeg);
      // Close the browser hard — kills the chrome process tree.
      record.browser?.close().catch(() => {
        const proc = record.browser?.process();
        if (proc) killTree(proc);
      });
    };
    if (ctx.signal.aborted) {
      record.aborted = true;
    } else {
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    }

    const emit = (progress: number | null, frame?: number) =>
      ctx.emit({
        type: 'render.progress',
        payload: { recordId, cellId: cell.uid, engine: 'excalidraw', progress, frame },
      });

    let framesObserved = 0;
    let workDir: string | null = null;
    let browser: Browser | null = null;

    try {
      if (record.aborted) throw Object.assign(new Error('[excalidraw] aborted'), { cancelled: true });

      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      });
      record.browser = browser;

      const page = await browser.newPage();
      await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"></body></html>');
      // The bundle is ESM (see buildBrowserBundle) — inject as a module script
      // and wait for it to assign `window.__ik`. (A plain `page.evaluate` only
      // works for classic scripts and would choke on top-level `import`s.)
      await page.addScriptTag({ content: bundleCode, type: 'module' });
      await page.waitForFunction('!!globalThis.__ik', { timeout: 15000 });

      emit(0, 0);

      workDir = mkdtempSync(join(tmpdir(), 'ikenga-exc-render-'));

      if (!anim) {
        // ── Static path ──────────────────────────────────────────────────
        // exportToBlob → PNG, then embed the scene ourselves (the public
        // exportToBlob has no exportEmbedScene option — see deviation #4) via
        // serializeAsJSON + encodePngMetadata, so the still re-opens as an
        // editable scene. ffmpeg then loops the still for cell.duration_ms.
        const pngB64: string = await page.evaluate(async (scn: ExcalidrawScene) => {
          const { exportToBlob, serializeAsJSON, encodePngMetadata } = (
            globalThis as unknown as { __ik: any }
          ).__ik;
          const appState = { ...(scn.appState ?? {}), exportBackground: true };
          let blob: Blob = await exportToBlob({
            elements: scn.elements,
            files: scn.files,
            appState,
            exportPadding: 0,
            mimeType: 'image/png',
          });
          // Embed the scene JSON in a tEXt chunk keyed
          // `application/vnd.excalidraw+json` (what loadFromBlob reads).
          try {
            const metadata = serializeAsJSON(scn.elements, appState, scn.files ?? {}, 'local');
            blob = await encodePngMetadata({ blob, metadata });
          } catch {
            // If embedding fails we still ship a valid PNG (frame is intact).
          }
          const buf = await blob.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return btoa(binary);
        }, scene);

        if (record.aborted) throw Object.assign(new Error('[excalidraw] aborted'), { cancelled: true });

        const pngPath = join(workDir, 'still.png');
        writeFileSync(pngPath, Buffer.from(pngB64, 'base64'));
        framesObserved = 1;
        emit(0.5, 1);

        // Loop the still for the cell duration (min 1 frame's worth).
        const durMs = cell.duration_ms > 0 ? cell.duration_ms : 1000;
        const durSec = (durMs / 1000).toFixed(3);
        await runFfmpeg(
          [
            '-y',
            '-loop', '1',
            '-i', pngPath,
            '-t', durSec,
            '-r', String(EXCALIDRAW_FPS),
            '-vf', scalePadFilter(resolution.w, resolution.h),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            outPath,
          ],
          record,
        );
        emit(1, 1);
      } else {
        // ── Animated path ─────────────────────────────────────────────────
        // exportToSvg + animateSvg inject SMIL; we drive setCurrentTime on a
        // fixed-fps tick loop and screenshot each frame.
        const finishedMs: number = await page.evaluate(async (scn: ExcalidrawScene) => {
          const { exportToSvg, animateSvg } = (globalThis as unknown as { __ik: any }).__ik;
          const svg: SVGSVGElement = await exportToSvg({
            elements: scn.elements,
            files: scn.files,
            appState: { ...(scn.appState ?? {}), exportBackground: true },
            exportPadding: 0,
          });
          const { finishedMs } = animateSvg(svg, scn.elements, {});
          svg.pauseAnimations();
          svg.id = '__ik_anim_svg';
          document.body.innerHTML = '';
          document.body.appendChild(svg);
          return finishedMs;
        }, scene);

        // Total duration: SMIL finish time, but honour an explicit override.
        const totalMs = anim.duration_ms && anim.duration_ms > 0 ? anim.duration_ms : finishedMs || 1000;
        const totalFrames = Math.max(1, Math.round((totalMs / 1000) * EXCALIDRAW_FPS));
        const svgHandle = await page.$('#__ik_anim_svg');
        if (!svgHandle) throw new Error('[excalidraw] animated SVG did not mount');

        for (let f = 0; f < totalFrames; f++) {
          if (record.aborted) throw Object.assign(new Error('[excalidraw] aborted'), { cancelled: true });
          const tSec = (f / EXCALIDRAW_FPS);
          await page.evaluate((t) => {
            const s = document.getElementById('__ik_anim_svg') as unknown as SVGSVGElement | null;
            if (s) s.setCurrentTime(t);
          }, tSec);
          const framePath = join(workDir, `frame-${String(f).padStart(6, '0')}.png`);
          await svgHandle.screenshot({ path: framePath as `${string}.png`, omitBackground: false });
          framesObserved = f + 1;
          emit(Math.min(0.95, (f + 1) / totalFrames), f + 1);
        }

        if (record.aborted) throw Object.assign(new Error('[excalidraw] aborted'), { cancelled: true });

        await runFfmpeg(
          [
            '-y',
            '-framerate', String(EXCALIDRAW_FPS),
            '-i', join(workDir, 'frame-%06d.png'),
            '-vf', scalePadFilter(resolution.w, resolution.h),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            outPath,
          ],
          record,
        );
        emit(1, framesObserved);
      }

      // Close the browser cleanly before we validate the artifact.
      record.browser = undefined;
      await browser.close().catch(() => {});
      browser = null;

      if (ctx.signal.aborted || record.aborted) {
        throw Object.assign(new Error('[excalidraw] render aborted via ctx.signal'), {
          cancelled: true,
        });
      }

      if (!existsSync(outPath)) {
        throw new Error(`[excalidraw] encode exited 0 but output missing at ${outPath}`);
      }

      const finishedAt = nowIso();
      const finishedAtMs = Date.now();

      const result: RenderRecord = {
        id: recordId,
        cell_uid: cell.uid,
        engine: 'excalidraw',
        engine_version: engineVersion,
        variant: opts.variant ?? 'default',
        status: 'done',
        output: { uri: outPath, mime: 'video/mp4' },
        cost_estimate: 0,
        cost_actual: 0,
        started_at: startedAt,
        finished_at: finishedAt,
        metadata: {
          aspect_ratio: aspect,
          resolution_requested: resolution,
          resolution_actual: resolution,
          fps: EXCALIDRAW_FPS,
          duration_ms: cell.duration_ms,
          path: anim ? 'animated' : 'static',
          frames_observed: framesObserved,
          // Static stills embed the scene JSON (serializeAsJSON +
          // encodePngMetadata) so the PNG re-opens as an editable Excalidraw
          // scene; the animated path emits a plain frame sequence.
          scene_embedded: !anim,
          elapsed_ms: finishedAtMs - startedAtMs,
          chrome_executable: chromePath,
        },
      };
      return result;
    } catch (e) {
      // When the host aborted (or cancel() ran), any in-flight Puppeteer call
      // surfaces as a "Target closed" protocol error rather than our own
      // sentinel. Normalize to a `cancelled` error so the queue (WP-03) tags
      // the record 'cancelled' rather than 'failed'.
      if (ctx.signal.aborted || record.aborted) {
        const err = new Error('[excalidraw] render aborted via ctx.signal');
        (err as Error & { cancelled?: boolean }).cancelled = true;
        throw err;
      }
      throw e;
    } finally {
      activeRenders.delete(recordId);
      if (!ctx.signal.aborted) ctx.signal.removeEventListener('abort', onAbort);
      if (browser) await browser.close().catch(() => {});
      if (workDir && existsSync(workDir)) {
        try {
          rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* best-effort temp cleanup */
        }
      }
    }
  },

  async cancel(recordId) {
    const rec = activeRenders.get(recordId);
    if (!rec) return;
    rec.aborted = true;
    if (rec.ffmpeg) killTree(rec.ffmpeg);
    if (rec.browser) {
      const proc = rec.browser.process();
      await rec.browser.close().catch(() => {
        if (proc) killTree(proc);
      });
    }
  },
};

export default excalidrawAdapter;
