/**
 * HyperFrames renderer adapter (WP-05).
 *
 * First concrete `RendererAdapter` for com.ikenga.studio. Spawns the
 * `hyperframes` CLI (`npx hyperframes render`) against the project root,
 * pointing at the cell's HTML composition via `--composition=…`.
 *
 * G24 — Chrome version pin. We thread `PUPPETEER_EXECUTABLE_PATH` (from
 * `./chrome.ts`) onto the spawned child so HF picks up our pinned binary
 * instead of downloading its own. The Excalidraw adapter (WP-05b) shares
 * the same resolver.
 *
 * G1 — aspect-ratio threading. HF's `--resolution` flag is preset-based
 * (landscape/portrait/square), not arbitrary W×H. We map the project's
 * resolved aspect ratio (RenderOptions.aspect_ratio ?? ctx.aspectRatio)
 * to the corresponding preset. The resulting MP4 dimensions match
 * DEFAULT_RESOLUTION for each aspect. (HF's `--resolution` cannot honour
 * a non-default override of `{w,h}` for the same aspect — see deviations
 * below.)
 *
 * G14 — output path. Lands at
 * `<rendersDir>/hyperframes/<rungDir(cell.rung)>/<uid>.mp4`. We call the
 * `rungDir()` schema helper rather than slicing the enum.
 *
 * G3 — engine_version. Cached from `npx hyperframes --version` on first
 * use; written into every emitted RenderRecord.
 *
 * ─── Deviations from the WP-05 brief ──────────────────────────────────
 *
 * 1. HF takes a composition-project DIR (verified against hyperframes
 *    0.6.36) and HARD-REQUIRES an `index.html` entry inside it — it refuses
 *    to start ("No index.html file found") otherwise. It does NOT accept a
 *    direct path to an arbitrary HTML file. So we point HF's DIR at the
 *    *cell's own directory* (`dirname(content_path)`, i.e.
 *    `cells/<rungDir>/<uid>/`) and rely on the cell entry being
 *    `index.html`. If the cell's entry has a non-index basename we still
 *    pass `-c <basename>`, but HF needs an `index.html` present regardless;
 *    the studio cell scaffolding (WP-07/WP-11) writes the cell HTML as
 *    `index.html`. The brief's `npx hyperframes render
 *    <projectRoot>/<cell.content_path>` form is not how the CLI works.
 *
 * 2. HF has no `--duration` flag. Composition duration is baked into the
 *    HTML via `data-composition-duration` (or computed from the longest
 *    animation). We DO NOT pass `--duration` (it would be ignored or
 *    rejected). `cell.duration_ms` is recorded on the RenderRecord
 *    metadata for traceability; the adapter does NOT attempt to override
 *    composition duration from outside the HTML.
 *
 * 3. HF has no `--width`/`--height` flags. Output framing is set via
 *    `--resolution=<preset>` (landscape, portrait, square, plus 4k
 *    variants). We map `16:9 → landscape`, `9:16 → portrait`,
 *    `1:1 → square`. An arbitrary `opts.resolution: {w:1280,h:720}` for
 *    aspect `16:9` can only land at the preset's 1920×1080 — we record
 *    the requested vs actual resolution on the RenderRecord metadata so
 *    consumers can detect the clamp. A future deviation might shell out
 *    to FFmpeg for a post-render scale.
 *
 * ─── Progress parsing ─────────────────────────────────────────────────
 *
 * HF (0.6.36) emits `Capturing frame N/M (W workers)` lines plus an
 * ANSI percent bar (`██░░  25%  Starting frame capture`) on stdout/stderr.
 * The bar updates via `\r`, not `\n`, so we split the byte stream on EITHER
 * and strip ANSI escapes before parsing. `Capturing frame N/M` gives an
 * exact total (preferred); the percent bar is a coarse fallback. We compute
 * `progress = currentFrame / total`, falling back to
 * `total = floor(cell.duration_ms / 1000 * fps)` (fps=30, HF's default)
 * when the capture line hasn't appeared yet. If `cell.duration_ms === 0`
 * AND no `N/M` line has arrived, `progress` is emitted as `null`
 * (indeterminate). We also accept FFmpeg-style `frame=NNN` lines if HF
 * surfaces the encoder output. NOTE: we deliberately do NOT pass `--quiet`,
 * which would suppress these progress lines.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  rungDir,
  DEFAULT_RESOLUTION,
  type AspectRatio,
  type Cell,
  type RenderRecord,
} from '@ikenga/studio-schema';

import { resolveChromeExecutable } from './chrome.js';
import { clearRenderPid, recordRenderPid } from '../queue.js';
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

const HF_DEFAULT_FPS = 30;

const ASPECT_TO_HF_PRESET: Record<AspectRatio, 'landscape' | 'portrait' | 'square'> = {
  '16:9': 'landscape',
  '9:16': 'portrait',
  '1:1': 'square',
};

// Children we've spawned, keyed by recordId, so cancel(recordId) can find them.
const activeChildren = new Map<string, ChildProcess>();

// engine_version is cached after first lookup — `npx hyperframes --version`
// costs ~500ms cold and shouldn't run per-render.
let cachedEngineVersion: string | null = null;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Terminate a detached child and its entire process group. SIGTERM first,
 * then SIGKILL after a short grace window so a wedged HF/chrome can't linger.
 * Killing the negative PID targets the whole group (npx + hyperframes +
 * chrome + ffmpeg), which a plain `child.kill()` would not reach.
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  const signalGroup = (sig: NodeJS.Signals) => {
    if (pid === undefined) return;
    try {
      process.kill(-pid, sig); // negative pid → process group
    } catch {
      // group already gone, or we're not the group leader — fall back to the
      // direct child handle.
      try {
        if (!child.killed) child.kill(sig);
      } catch {
        // already exited
      }
    }
  };
  signalGroup('SIGTERM');
  setTimeout(() => signalGroup('SIGKILL'), 1200);
}

/** Spawn `npx hyperframes --version` once; cache the trimmed output. */
async function detectEngineVersion(): Promise<string> {
  if (cachedEngineVersion !== null) return cachedEngineVersion;
  return new Promise<string>((resolveExit) => {
    const child = spawn('npx', ['--yes', 'hyperframes', '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')));
    child.stderr.on('data', (b: Buffer) => (out += b.toString('utf8')));
    child.on('error', () => {
      cachedEngineVersion = 'unknown';
      resolveExit('unknown');
    });
    child.on('close', () => {
      // Output may be just "0.6.36\n" or "hyperframes v0.6.36 …"; extract the
      // first semver-shaped token.
      const m = out.match(/(\d+\.\d+\.\d+[\w.-]*)/);
      cachedEngineVersion = m ? m[1] : out.trim() || 'unknown';
      resolveExit(cachedEngineVersion);
    });
  });
}

/** Resolve a unique output path under `rendersDir/hyperframes/<rungDir>/`. */
function resolveOutputPath(cell: Cell, ctx: RenderContext): string {
  const dir = join(ctx.rendersDir, 'hyperframes', rungDir(cell.rung));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const base = join(dir, `${cell.uid}.mp4`);
  if (!existsSync(base)) return base;
  // Collision — append a short UUID suffix.
  const suffix = randomUUID().slice(0, 8);
  return join(dir, `${cell.uid}.${suffix}.mp4`);
}

function resolveAspect(opts: RenderOptions, ctx: RenderContext): AspectRatio {
  return opts.aspect_ratio ?? ctx.aspectRatio;
}

/** Aspect declared by the composition HTML itself (`data-width`/`data-height`
 *  per the HF 0.6.36 contract). A portrait-authored cell in a 16:9 project
 *  must render portrait or HF aborts with a framing error — the schema has no
 *  per-cell aspect, so the content is the only authority. An explicit
 *  `opts.aspect_ratio` per-call override still wins. */
function contentDeclaredAspect(contentPath: string): AspectRatio | undefined {
  try {
    const html = readFileSync(contentPath, 'utf8');
    const w = Number(/data-width="(\d+)"/.exec(html)?.[1]);
    const h = Number(/data-height="(\d+)"/.exec(html)?.[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
    if (w === h) return '1:1';
    return h > w ? '9:16' : '16:9';
  } catch {
    return undefined;
  }
}

function resolveResolution(
  opts: RenderOptions,
  ctx: RenderContext,
  aspect: AspectRatio,
): { w: number; h: number } {
  return opts.resolution ?? ctx.resolution ?? DEFAULT_RESOLUTION[aspect];
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Resolve a cell's absolute content path. `cell.content_path` is relative
 * to `ctx.projectRoot` per the schema convention.
 */
function absContentPath(cell: Cell, ctx: RenderContext): string {
  return isAbsolute(cell.content_path)
    ? cell.content_path
    : resolve(ctx.projectRoot, cell.content_path);
}

/**
 * Parse HF stderr/stdout lines for progress. Returns `null` if the line
 * carries no progress signal.
 *
 * HF (0.6.x) emits, in order of usefulness:
 *   • `Capturing frame 30/90 (3 workers)` — frame N of M (most reliable;
 *     gives us an exact total independent of cell.duration_ms).
 *   • a percent bar: `██████░░░  25%  Starting frame capture` — coarse
 *     fallback, expressed as a normalized 0..1.
 *   • FFmpeg-style `frame=  123` lines if HF surfaces the encoder output.
 *
 * Returns either `{ frame, total }` (frame-count form), or `{ pct }`
 * (percent-bar form), so the caller can prefer the precise signal.
 */
function parseProgressLine(
  line: string,
): { frame: number; total: number | null } | { pct: number } | null {
  // "Capturing frame 30/90 (…)" — HF's canonical capture-phase line.
  const cap = line.match(/Capturing\s+frame\s+(\d+)\s*\/\s*(\d+)/i);
  if (cap) return { frame: Number(cap[1]), total: Number(cap[2]) };
  // Generic "Rendering frame 12/300".
  const m1 = line.match(/Rendering\s+frame\s+(\d+)\s*\/\s*(\d+)/i);
  if (m1) return { frame: Number(m1[1]), total: Number(m1[2]) };
  // FFmpeg-style "frame=  123".
  const m2 = line.match(/(?:^|\s)frame\s*=\s*(\d+)/);
  if (m2) return { frame: Number(m2[1]), total: null };
  // Percent bar: "…  25%  Starting frame capture".
  const pct = line.match(/(\d{1,3})%\s/);
  if (pct) {
    const v = Number(pct[1]);
    if (v >= 0 && v <= 100) return { pct: v / 100 };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────

export const hyperframesAdapter: RendererAdapter = {
  id: 'hyperframes',

  capabilities: {
    still: false,
    video: true,
    interactive: false,
    range: true,
    combine: false,
    aspect_ratios: ['16:9', '9:16', '1:1'],
    max_duration_ms: null,
    supported_codecs: ['h264'],
    requires_network: false,
  },

  async validate(cell, ctx) {
    const diags: Diagnostic[] = [];
    const abs = absContentPath(cell, ctx);

    // 1. Existence.
    if (!existsSync(abs)) {
      diags.push({
        severity: 'error',
        code: 'content-missing',
        message: `Cell content not found on disk: ${abs}`,
        path: 'content_path',
      });
      return diags; // no point checking type if missing
    }

    // 2. Extension.
    if (!abs.toLowerCase().endsWith('.html')) {
      diags.push({
        severity: 'error',
        code: 'unsupported-content-type',
        message: 'HyperFrames requires .html cell content',
        path: 'content_path',
      });
    }

    // 3. Non-empty.
    let bytes = 0;
    try {
      bytes = statSync(abs).size;
    } catch {
      // already caught by existence check above
    }
    if (bytes === 0) {
      diags.push({
        severity: 'error',
        code: 'content-empty',
        message: 'Cell HTML file is empty',
        path: 'content_path',
      });
    }

    // 4. Regex-light HTML sanity (don't pull in a full parser for P1).
    if (bytes > 0 && abs.toLowerCase().endsWith('.html')) {
      try {
        const body = readFileSync(abs, 'utf8');
        if (!/<html|<body|<div|<section|<main|<svg|<canvas/i.test(body)) {
          diags.push({
            severity: 'warning',
            code: 'html-no-renderable-root',
            message:
              "HTML appears to have no renderable root element (no <html>/<body>/<div>/<svg>/<canvas>). HyperFrames may render a blank frame.",
            path: 'content_path',
          });
        }
      } catch {
        // unreadable — surface as an error
        diags.push({
          severity: 'error',
          code: 'content-unreadable',
          message: `Could not read HTML file at ${abs}`,
          path: 'content_path',
        });
      }
    }

    // 5. Capability cross-check (G1/G2) — defensive; the dispatcher (WP-06)
    //    is supposed to gate this, but a direct adapter caller could skip.
    //    `validate()` is a fine place for a second line of defence.
    const aspect = ctx.aspectRatio;
    if (!hyperframesAdapter.capabilities.aspect_ratios.includes(aspect)) {
      diags.push({
        severity: 'error',
        code: 'aspect-not-supported',
        message: `HyperFrames does not support aspect ratio ${aspect}`,
      });
    }

    return diags;
  },

  async preview(cell, ctx) {
    const abs = absContentPath(cell, ctx);
    // The iframe's <hyperframes-player> loads the file directly. file:// URI
    // is the cheapest representation — no copy, no encode.
    const url: PreviewURL = `file://${abs}`;
    return url;
  },

  async render(cell, opts, ctx) {
    const recordId = randomUUID();
    const startedAt = nowIso();
    const startedAtMs = Date.now();

    const aspect =
      opts.aspect_ratio
      ?? contentDeclaredAspect(absContentPath(cell, ctx))
      ?? resolveAspect(opts, ctx);
    const requestedResolution = resolveResolution(opts, ctx, aspect);
    const preset = ASPECT_TO_HF_PRESET[aspect];

    // HF treats its positional DIR argument as a *composition project* and
    // hard-requires an `index.html` entry inside it (it refuses to start
    // otherwise — see deviation #1). The cell's HTML lives in its own
    // directory (`cells/<rungDir>/<uid>/<file>`), so we point HF's DIR at
    // that directory. When the cell's entry file is already `index.html`
    // we pass no `-c`; for any other basename we pass `-c <basename>` (HF
    // still needs an index.html present alongside, which the studio's cell
    // scaffolding guarantees).
    const cellHtmlAbs = absContentPath(cell, ctx);
    const cellHtmlDir = dirname(cellHtmlAbs);
    const cellHtmlBase = cellHtmlAbs.slice(cellHtmlDir.length + 1);
    const projectDir = cellHtmlDir;
    const needsComposition = cellHtmlBase.toLowerCase() !== 'index.html';

    const outPath = resolveOutputPath(cell, ctx);
    // Ensure the parent dir for `out` exists (resolveOutputPath already does
    // this, but the user could swap rendersDir mid-call — be defensive).
    const outDir = dirname(outPath);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    // Resolve the pinned Chrome — fail fast if it isn't installed yet so
    // the caller gets a clear error rather than HF downloading its own.
    let chromePath: string;
    try {
      chromePath = resolveChromeExecutable();
    } catch (e) {
      throw new Error(
        `[hyperframes] Chrome not available: ${(e as Error).message}`,
      );
    }

    const engineVersion = await detectEngineVersion();

    const argv = [
      '--yes',
      'hyperframes',
      'render',
      projectDir,
      ...(needsComposition ? ['-c', cellHtmlBase] : []),
      '-o',
      outPath,
      '--resolution',
      preset,
      '--fps',
      String(HF_DEFAULT_FPS),
      // NOTE: HF has no `--duration`/`--width`/`--height` flags — duration is
      // declared inside the composition HTML (data-duration) and framing is
      // set via the `--resolution` preset (see deviations #2/#3). We do NOT
      // pass `--quiet`: it suppresses the `Capturing frame N/M` progress
      // lines our progress parser depends on.
    ];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PUPPETEER_EXECUTABLE_PATH: chromePath,
      // Prevent puppeteer-deep deps from trying to download Chrome on the fly.
      PUPPETEER_SKIP_DOWNLOAD: 'true',
    };

    // `detached: true` puts the child (npx) in its own process group, so
    // killing the *group* (negative PID) reaps the whole npx → hyperframes →
    // chrome → ffmpeg tree — a plain `child.kill()` only hits npx and leaves
    // chrome/ffmpeg grandchildren orphaned. See `killTree` below.
    const child = spawn('npx', argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: true,
    });
    activeChildren.set(recordId, child);
    // Persist the group-leader PID so a fresh sidecar (after a crash) can reap
    // this detached group before re-queuing the render — otherwise two writers
    // would race the same output file. Cleared on close below.
    if (child.pid !== undefined) recordRenderPid(recordId, child.pid);

    // Wire cancellation via the host signal.
    const onAbort = () => {
      killTree(child);
    };
    if (ctx.signal.aborted) {
      onAbort();
    } else {
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Compute total frames if we can (G1 — cell.duration_ms is ms).
    const totalFramesFromDuration =
      cell.duration_ms > 0
        ? Math.max(1, Math.floor((cell.duration_ms / 1000) * HF_DEFAULT_FPS))
        : null;

    // Line-buffered stderr → progress events. Tail stdout too in case HF
    // ever decides to emit progress there.
    const stderrTail: string[] = [];
    let lastProgress = -1;
    let lastFrame = 0;
    let knownTotal: number | null = totalFramesFromDuration;

    const emitProgress = (progress: number | null, frame: number): void => {
      // De-dupe on rounded percent (or raw frame when total is unknown).
      const bucket = progress === null ? frame : Math.floor(progress * 100);
      if (bucket === lastProgress) return;
      lastProgress = bucket;
      ctx.emit({
        type: 'render.progress',
        payload: {
          recordId,
          cellId: cell.uid,
          engine: 'hyperframes',
          progress,
          frame,
        },
      });
    };

    const handleLine = (raw: string): void => {
      // Strip ANSI escape sequences (HF uses `\x1b[2K` etc. on the progress bar).
      // eslint-disable-next-line no-control-regex
      const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
      if (line.length === 0) return;
      stderrTail.push(line);
      if (stderrTail.length > 200) stderrTail.shift();
      const p = parseProgressLine(line);
      if (!p) return;
      if ('frame' in p) {
        lastFrame = p.frame;
        if (p.total !== null) knownTotal = p.total;
        const total = knownTotal;
        const progress = total && total > 0 ? Math.min(1, p.frame / total) : null;
        emitProgress(progress, p.frame);
      } else {
        // Percent-bar fallback — derive a frame estimate from the known total.
        const total = knownTotal;
        const frame = total ? Math.round(p.pct * total) : Math.round(p.pct * 100);
        if (frame > lastFrame) lastFrame = frame;
        emitProgress(p.pct, frame);
      }
    };

    const bufferLines = (stream: NodeJS.ReadableStream): void => {
      let pending = '';
      stream.on('data', (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        // HF updates the progress bar with `\r`; capture-frame lines use `\n`.
        // Split on either so the bar updates surface as discrete lines.
        let idx: number;
        while ((idx = pending.search(/[\r\n]/)) >= 0) {
          const line = pending.slice(0, idx);
          pending = pending.slice(idx + 1);
          if (line.length > 0) handleLine(line);
        }
      });
      stream.on('end', () => {
        if (pending.length > 0) handleLine(pending);
      });
    };

    if (child.stderr) bufferLines(child.stderr);
    if (child.stdout) bufferLines(child.stdout);

    // Wait for completion / failure / abort.
    const exitCode: number | null = await new Promise<number | null>((resolveExit) => {
      child.once('error', () => resolveExit(null));
      child.once('close', (code) => resolveExit(code));
    });
    activeChildren.delete(recordId);
    clearRenderPid(recordId);

    const finishedAt = nowIso();
    const finishedAtMs = Date.now();

    if (ctx.signal.aborted) {
      // Cancellation is not a failure; throw a distinct error the queue can
      // tag as 'cancelled' rather than 'failed'.
      const err = new Error('[hyperframes] render aborted via ctx.signal');
      (err as Error & { cancelled?: boolean }).cancelled = true;
      throw err;
    }

    if (exitCode !== 0) {
      const tail = stderrTail.slice(-20).join('\n');
      throw new Error(
        `[hyperframes] render failed (exit ${exitCode ?? 'spawn-error'}):\n${tail}`,
      );
    }

    if (!existsSync(outPath)) {
      throw new Error(
        `[hyperframes] render exited 0 but output not found at ${outPath}\n` +
          stderrTail.slice(-20).join('\n'),
      );
    }

    const record: RenderRecord = {
      id: recordId,
      cell_uid: cell.uid,
      engine: 'hyperframes',
      engine_version: engineVersion,
      variant: opts.variant ?? 'default',
      status: 'done',
      output: {
        uri: outPath,
        mime: 'video/mp4',
      },
      cost_estimate: 0,
      cost_actual: 0,
      started_at: startedAt,
      finished_at: finishedAt,
      metadata: {
        aspect_ratio: aspect,
        resolution_requested: requestedResolution,
        resolution_actual: DEFAULT_RESOLUTION[aspect],
        hf_resolution_preset: preset,
        fps: HF_DEFAULT_FPS,
        duration_ms: cell.duration_ms,
        frames_observed: lastFrame,
        elapsed_ms: finishedAtMs - startedAtMs,
        chrome_executable: chromePath,
      },
    };
    return record;
  },

  async cancel(recordId) {
    const child = activeChildren.get(recordId);
    if (!child) return;
    killTree(child);
  },
};

export default hyperframesAdapter;
