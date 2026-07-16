/**
 * fal.ai renderer adapter (Stage 1 — network AI video/still engine).
 *
 * First NETWORK `RendererAdapter` for com.ikenga.studio. Unlike the
 * deterministic local engines (hyperframes, excalidraw), this adapter has no
 * on-disk cell content: it drives a fal.ai model from the cell's `prompt`
 * (+ optional anchor image reference) via `@fal-ai/client`, streams queue
 * updates as `render.progress`, then downloads the produced MP4 to the
 * renders directory.
 *
 * ─── Key resolution ───────────────────────────────────────────────────────
 * The fal credential comes from `ctx.vault.get('studio.fal')` (the Stronghold
 * vault surface, wired in-shell) with a `process.env.FAL_KEY` fallback for
 * headless / CI / stdio-driven runs. No key is ever hardcoded.
 *
 * ─── Model ids are CONFIG ──────────────────────────────────────────────────
 * fal model ids drift. They are read from env with cheap documented defaults
 * (see FAL_VIDEO_MODEL_DEFAULT / FAL_IMAGE_MODEL_DEFAULT) and can be
 * per-cell-overridden via `cell.metadata.fal_model` or per-call via
 * `RenderOptions.variant`. VERIFY the defaults against https://fal.ai/models.
 *
 * ─── G14 — output path ─────────────────────────────────────────────────────
 * Lands at `<rendersDir>/fal/<rungDir(cell.rung)>/<uid>.mp4` via the
 * `rungDir()` schema helper (same convention as hyperframes/excalidraw).
 *
 * ─── Cancellation ──────────────────────────────────────────────────────────
 * The simple `fal.subscribe` API exposes no request handle, so cancel is
 * best-effort: we race the subscribe promise against `ctx.signal`; on abort we
 * stop waiting and surface a `cancelled`-tagged error (the queue tags the
 * record 'cancelled' rather than 'failed'). The in-flight fal job may still
 * complete server-side — we simply do not download its output.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { fal } from '@fal-ai/client';

import {
  rungDir,
  type AspectRatio,
  type Cell,
  type RenderRecord,
} from '@ikenga/studio-schema';

import { readProject } from '../storyboard-fs.js';
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

// Cheap text/image-to-video default. VERIFY against https://fal.ai/models —
// model ids drift; override via FAL_VIDEO_MODEL or cell.metadata.fal_model.
const FAL_VIDEO_MODEL_DEFAULT = 'fal-ai/ltx-video';

// Cheap stills default. VERIFY against https://fal.ai/models — override via
// FAL_IMAGE_MODEL.
const FAL_IMAGE_MODEL_DEFAULT = 'fal-ai/flux/schnell';

// Anchor kinds that carry a usable image reference for image-to-video /
// character-location continuity.
const IMAGE_ANCHOR_KINDS = new Set(['image', 'character', 'location']);

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** Read the fal key from the vault, falling back to FAL_KEY env. */
async function resolveKey(ctx: RenderContext): Promise<string | undefined> {
  let fromVault: string | undefined;
  try {
    // Vault key follows the studio.<adapter> convention (veo/kling/runway).
    fromVault = await ctx.vault.get('studio.fal');
  } catch {
    fromVault = undefined;
  }
  return fromVault ?? process.env.FAL_KEY;
}

/** Resolve a unique output path under `rendersDir/fal/<rungDir>/`. */
function resolveOutputPath(cell: Cell, ctx: RenderContext): string {
  const dir = join(ctx.rendersDir, 'fal', rungDir(cell.rung));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const base = join(dir, `${cell.uid}.mp4`);
  if (!existsSync(base)) return base;
  const suffix = randomUUID().slice(0, 8);
  return join(dir, `${cell.uid}.${suffix}.mp4`);
}

/** Resolve the video model id (call override → cell metadata → env → default). */
function resolveVideoModel(
  cell: Cell,
  opts: RenderOptions,
  flags?: { hasImage?: boolean },
): string {
  const fromMeta = (cell.metadata as Record<string, unknown> | undefined)?.fal_model;
  const override =
    opts.variant ||
    (typeof fromMeta === 'string' ? fromMeta : '') ||
    process.env.FAL_VIDEO_MODEL ||
    '';
  // The Canvas picker uses friendly short names (ltx-video, flux, …); fal's
  // API requires the full <owner>/<app> id. Pass through anything already
  // owner-qualified, otherwise prefix the default owner so e.g. "ltx-video"
  // resolves to "fal-ai/ltx-video".
  const raw = override || FAL_VIDEO_MODEL_DEFAULT;
  const qualified = raw.includes('/') ? raw : `fal-ai/${raw}`;
  // Image-to-video: a text-to-video endpoint ignores `image_url` (silent drift
  // — the plate stops anchoring the output) or 422s. Auto-switch to the i2v
  // sibling (`fal-ai/ltx-video/image-to-video`) ONLY when no override was
  // supplied (we fell through to the default) AND an anchor image is present.
  // An explicit override is honored verbatim — even if its value happens to
  // equal the default id — so a caller can force t2v with an image by pinning
  // the model; if you want i2v with a custom base, pass the i2v endpoint id.
  const fromDefault = override.length === 0;
  if (flags?.hasImage && fromDefault) {
    return `${FAL_VIDEO_MODEL_DEFAULT}/image-to-video`;
  }
  return qualified;
}

/** Extract a negative prompt from the cell's open metadata bag, if present. */
function readNegativePrompt(cell: Cell): string | undefined {
  const meta = cell.metadata as Record<string, unknown> | undefined;
  const neg = meta?.negative ?? meta?.negative_prompt;
  return typeof neg === 'string' && neg.trim().length > 0 ? neg : undefined;
}

/** Video output url from a fal result payload (model-shape tolerant). */
function extractVideoUrl(data: unknown): string | undefined {
  const d = data as
    | { video?: { url?: string }; videos?: Array<{ url?: string }> }
    | undefined;
  return d?.video?.url ?? d?.videos?.[0]?.url;
}

/** Still-image output url from a fal result payload (model-shape tolerant). */
function extractImageUrl(data: unknown): string | undefined {
  const d = data as
    | { images?: Array<{ url?: string }>; image?: { url?: string } }
    | undefined;
  return d?.images?.[0]?.url ?? d?.image?.url;
}

/** Best-effort spend extraction — fal rarely returns a cost field. */
function extractCost(res: unknown): number | undefined {
  const r = res as
    | { data?: { cost?: unknown }; metrics?: { cost?: unknown } }
    | undefined;
  const c = r?.data?.cost ?? r?.metrics?.cost;
  return typeof c === 'number' ? c : undefined;
}

/** Download a remote url to `outPath`. Throws on a non-OK response. */
async function downloadTo(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[fal] download failed (${res.status} ${res.statusText}) for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, buf);
}

/** Result of resolving a cell's image reference: a fetchable url, or why not. */
interface ImageRef {
  url: string | undefined;
  /** Set when an anchor was present but its file could not be uploaded — the
   * render falls back to text-only, and the caller surfaces this cause. */
  uploadError?: string;
}

/**
 * Resolve the cell's first image/character/location anchor to a fetchable
 * url. `http(s)` uris pass through; local files are uploaded to fal storage
 * (fal.config must already be applied) so the model can fetch them. Returns
 * `{ url: undefined }` when no usable anchor exists — a text-only render is
 * valid. An upload failure is returned as `{ uploadError }` (NOT swallowed)
 * so the render record + progress log explain the text-only fallback.
 */
async function resolveImageRefUrl(cell: Cell, ctx: RenderContext): Promise<ImageRef> {
  if (!cell.anchors || cell.anchors.length === 0) return { url: undefined };

  let anchors: Array<{ id: string; kind: string; asset?: { uri?: string; mime?: string } }>;
  try {
    anchors = readProject(ctx.projectRoot).anchors as typeof anchors;
  } catch {
    return { url: undefined };
  }
  const byId = new Map(anchors.map((a) => [a.id, a]));

  // If a usable anchor is found but its file can't be resolved/uploaded, we
  // keep trying the remaining anchors; this holds the last reason so a
  // fully-text-only outcome still explains WHY (rather than looking like the
  // cell never had an anchor).
  let fallbackError: string | undefined;

  for (const id of cell.anchors) {
    const a = byId.get(id);
    if (!a || !IMAGE_ANCHOR_KINDS.has(a.kind)) continue;
    const uri = a.asset?.uri;
    if (!uri) continue;
    if (/^https?:\/\//i.test(uri)) return { url: uri };

    // Local file — resolve to an absolute path and upload for a fetchable url.
    // An anchor's AssetRef.uri is the assets-relative id (e.g. 'images/x.png'),
    // which lives under `<projectRoot>/assets/` per the assets.ts convention
    // (resolveAsset prepends `assets/`). Try that first; fall back to a
    // project-root-relative path for absolute-style refs.
    let abs: string;
    if (uri.startsWith('file://')) abs = fileURLToPath(uri);
    else if (isAbsolute(uri)) abs = uri;
    else {
      const underAssets = resolve(ctx.projectRoot, 'assets', uri);
      abs = existsSync(underAssets) ? underAssets : resolve(ctx.projectRoot, uri);
    }
    if (!existsSync(abs)) {
      // Missing on disk — same silent-drift class as an upload failure. Record
      // the reason and try the remaining anchors before falling back.
      fallbackError = `anchor ${a.id} (${a.kind}) reference file not found on disk (${uri})`;
      continue;
    }
    try {
      const bytes = readFileSync(abs);
      const blob = new Blob([bytes], { type: a.asset?.mime ?? 'application/octet-stream' });
      return { url: await fal.storage.upload(blob) };
    } catch (e) {
      // Upload failed — do NOT swallow: surface the cause so the caller can log
      // why this image-to-video render fell back to text-only (a silent
      // downgrade on a money-spending op hides a broken reference plate).
      return {
        url: undefined,
        uploadError: `anchor ${a.id} (${a.kind}) upload failed: ${(e as Error).message}`,
      };
    }
  }
  return { url: undefined, uploadError: fallbackError };
}

/**
 * Build the fal model input. Field names are model-dependent and drift; these
 * are the common fal video-model fields. Unknown fields a given model doesn't
 * accept are ignored server-side / surfaced as a validation error the caller
 * sees as a failed render.
 */
function buildVideoInput(args: {
  cell: Cell;
  imageUrl?: string;
  aspect?: AspectRatio;
}): Record<string, unknown> {
  const { cell, imageUrl, aspect } = args;
  const input: Record<string, unknown> = { prompt: cell.prompt };
  const negative = readNegativePrompt(cell);
  if (negative) input.negative_prompt = negative;
  if (imageUrl) input.image_url = imageUrl;
  if (typeof cell.seed === 'number') input.seed = cell.seed;
  // aspect_ratio is honored by text-to-video models but REJECTED by the
  // image-to-video sibling (which derives framing from the image), so only set
  // it for text-to-video renders. A cell can still force the field verbatim via
  // metadata.fal_input if a specific i2v model needs it.
  if (!imageUrl && aspect) input.aspect_ratio = aspect;
  // Model-specific extras (aspect_ratio / duration / num_frames / start_image_url …)
  // differ per fal model and a *hard 422* on an unaccepted field is common — e.g.
  // `fal-ai/ltx-video/image-to-video` rejects both aspect_ratio and duration (it
  // derives framing from the image). So the default input stays lean
  // (prompt + image_url + negative + seed); a cell opts a specific model's extra
  // fields in verbatim via `metadata.fal_input`.
  const extra = (cell.metadata as Record<string, unknown> | undefined)?.fal_input;
  if (extra && typeof extra === 'object') {
    Object.assign(input, extra as Record<string, unknown>);
  }
  return input;
}

// ─────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────

export const falAdapter: RendererAdapter = {
  id: 'fal',

  capabilities: {
    still: true,
    video: true,
    interactive: false,
    range: false,
    combine: false,
    aspect_ratios: ['16:9', '9:16', '1:1'],
    max_duration_ms: null,
    supported_codecs: ['h264'],
    requires_network: true,
  },

  async validate(cell, ctx) {
    const diags: Diagnostic[] = [];

    if (!cell.prompt || cell.prompt.trim().length === 0) {
      diags.push({
        severity: 'error',
        code: 'prompt-empty',
        message: 'fal requires a non-empty prompt',
        path: 'prompt',
      });
    }

    const key = await resolveKey(ctx);
    if (!key) {
      diags.push({
        severity: 'warning',
        code: 'fal-key-missing',
        message:
          'No fal key available (vault `studio.fal` / FAL_KEY unset) — render will fail until a key is provided',
      });
    }

    return diags;
  },

  async preview(cell, _ctx) {
    // Cheap, no real generation (G — previews must not spend). A neutral
    // poster placeholder; the real frame only exists after render().
    void cell;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
      '<rect width="100%" height="100%" fill="#1b1714"/>' +
      '<text x="50%" y="50%" fill="#c9bfb4" font-family="sans-serif" font-size="16" ' +
      'text-anchor="middle" dominant-baseline="middle">AI video (fal)</text></svg>';
    const url: PreviewURL = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return url;
  },

  async render(cell, opts, ctx) {
    const recordId = randomUUID();
    const startedAt = nowIso();
    const startedAtMs = Date.now();

    const key = await resolveKey(ctx);
    if (!key) {
      throw new Error(
        '[fal] studio.fal not set — provide it via the vault (`studio.fal`) or the FAL_KEY env var',
      );
    }
    // NOTE: fal.config mutates global SDK state. Safe today because the render
    // queue drains serially (one render at a time), but under future concurrency
    // this would need per-call credentials (e.g. a scoped client) to avoid
    // clobbering an in-flight job's key.
    fal.config({ credentials: key });

    const aspect: AspectRatio = opts.aspect_ratio ?? ctx.aspectRatio;
    const imageRef = await resolveImageRefUrl(cell, ctx);
    const imageUrl = imageRef.url;
    if (imageRef.uploadError) {
      // Don't abort — a text-only render is valid — but make the fallback loud
      // so progress + the record explain why an anchor-driven render didn't use
      // the reference plate. recordId is in scope (declared at the top of render).
      ctx.emit({
        type: 'render.progress',
        payload: {
          recordId,
          cellId: cell.uid,
          engine: 'fal',
          progress: null,
          message: `[fal] ${imageRef.uploadError}; falling back to text-only`,
        },
      });
    }
    // Resolve the model AFTER the image ref so image-to-video can switch to the
    // i2v sibling endpoint (see resolveVideoModel).
    const model = resolveVideoModel(cell, opts, { hasImage: !!imageUrl });
    const input = buildVideoInput({ cell, imageUrl, aspect });

    const outPath = resolveOutputPath(cell, ctx);

    // Never submit a fal job after the signal already aborted. The simple
    // subscribe API submits (and bills) server-side on call, and ctx.signal is
    // not threaded into the SDK's HTTP request, so without this guard a cancel
    // that lands during the awaits above would still spend money. Checked
    // BEFORE the abort-listener setup below so we never create an abort promise
    // that would later reject with no consumer (an unhandledRejection).
    if (ctx.signal.aborted) {
      throw Object.assign(new Error('[fal] render aborted before submit'), {
        cancelled: true,
      });
    }

    let lastMessage = '';
    const emitProgress = (message: string): void => {
      // De-dupe on message content to avoid a flood of identical lines.
      if (message === lastMessage) return;
      lastMessage = message;
      ctx.emit({
        type: 'render.progress',
        payload: {
          recordId,
          cellId: cell.uid,
          engine: 'fal',
          progress: null,
          message,
        },
      });
    };

    // Cancellation: race the subscribe against ctx.signal (best-effort — the
    // simple subscribe API exposes no server-side cancel handle). The guard
    // above already handled the pre-abort case, so the signal is not yet
    // aborted here — just attach the listener (no microtask dance needed).
    let abortReject: ((e: Error) => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      abortReject = reject;
    });
    const onAbort = () => {
      abortReject?.(Object.assign(new Error('[fal] render aborted via ctx.signal'), {
        cancelled: true,
      }));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    let res: Awaited<ReturnType<typeof fal.subscribe>>;
    try {
      const subscribePromise = fal.subscribe(model, {
        input,
        logs: true,
        onQueueUpdate: (update) => {
          const u = update as {
            status?: string;
            logs?: Array<{ message?: string }>;
          };
          if (u.status === 'IN_PROGRESS' || u.status === 'IN_QUEUE') {
            const last = u.logs?.filter((l) => !!l?.message).pop();
            emitProgress(last?.message ?? u.status);
          }
        },
      });
      res = await Promise.race([subscribePromise, abortPromise]);
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }

    if (ctx.signal.aborted) {
      throw Object.assign(new Error('[fal] render aborted via ctx.signal'), {
        cancelled: true,
      });
    }

    const videoUrl = extractVideoUrl(res.data);
    if (!videoUrl) {
      throw new Error(
        `[fal] model ${model} returned no video url (data keys: ${Object.keys(
          (res.data as Record<string, unknown>) ?? {},
        ).join(', ') || 'none'})`,
      );
    }

    await downloadTo(videoUrl, outPath);
    if (!existsSync(outPath) || statSync(outPath).size === 0) {
      throw new Error(`[fal] downloaded output missing or empty at ${outPath}`);
    }

    const finishedAt = nowIso();
    const finishedAtMs = Date.now();
    const cost = extractCost(res);
    const requestId = (res as { requestId?: string }).requestId;

    const record: RenderRecord = {
      id: recordId,
      cell_uid: cell.uid,
      engine: 'fal',
      model_id: model,
      engine_version: undefined,
      variant: opts.variant ?? 'default',
      status: 'done',
      output: { uri: outPath, mime: 'video/mp4' },
      // Pass the real cost through unchanged (undefined when fal returns none —
      // the common case for video models). Forcing a 0 here made the Ledger
      // display every fal render as free despite real credit spend.
      cost_estimate: cost,
      cost_actual: cost,
      started_at: startedAt,
      finished_at: finishedAt,
      metadata: {
        model,
        aspect_ratio: aspect,
        seed: cell.seed,
        image_ref: imageUrl,
        request_id: requestId,
        elapsed_ms: finishedAtMs - startedAtMs,
        ...(imageRef.uploadError ? { image_ref_error: imageRef.uploadError } : {}),
      },
    };
    return record;
  },
};

/**
 * Standalone still generator — runs FAL_IMAGE_MODEL and downloads the image
 * to `outPath`. Imported by Stage 3 (anchor plates) to mint reference stills.
 * Independent of the RendererAdapter surface so it can be called without a
 * full RenderContext.
 */
export async function generateStill(
  opts: {
    prompt: string;
    model?: string;
    seed?: number;
    aspect?: AspectRatio;
    keyGetter: () => Promise<string | undefined>;
  },
  outPath: string,
): Promise<{ uri: string; model_id: string; cost?: number }> {
  const key = (await opts.keyGetter()) ?? process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      '[fal] studio.fal not set — provide it via keyGetter (vault `studio.fal`) or the FAL_KEY env var',
    );
  }
  // NOTE: fal.config mutates global SDK state. Safe today because generateStill
  // is called from the serial anchor-generation path (one at a time); under
  // concurrency this would need a scoped client to avoid key clobbering.
  fal.config({ credentials: key });

  const model = opts.model || process.env.FAL_IMAGE_MODEL || FAL_IMAGE_MODEL_DEFAULT;

  const input: Record<string, unknown> = { prompt: opts.prompt };
  if (typeof opts.seed === 'number') input.seed = opts.seed;
  if (opts.aspect) input.aspect_ratio = opts.aspect;

  const res = await fal.subscribe(model, { input, logs: false });
  const url = extractImageUrl(res.data);
  if (!url) {
    throw new Error(`[fal] image model ${model} returned no image url`);
  }
  await downloadTo(url, outPath);
  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    throw new Error(`[fal] downloaded still missing or empty at ${outPath}`);
  }
  return { uri: outPath, model_id: model, cost: extractCost(res) };
}

export default falAdapter;
