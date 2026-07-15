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
 * The fal credential comes from `ctx.vault.get('fal.key')` (the Stronghold
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

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
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
    fromVault = await ctx.vault.get('fal.key');
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
function resolveVideoModel(cell: Cell, opts: RenderOptions): string {
  const fromMeta = (cell.metadata as Record<string, unknown> | undefined)?.fal_model;
  return (
    opts.variant ||
    (typeof fromMeta === 'string' ? fromMeta : '') ||
    process.env.FAL_VIDEO_MODEL ||
    FAL_VIDEO_MODEL_DEFAULT
  );
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
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, buf);
}

/**
 * Resolve the cell's first image/character/location anchor to a fetchable
 * url. `http(s)` uris pass through; local files are uploaded to fal storage
 * (fal.config must already be applied) so the model can fetch them. Returns
 * `undefined` when no usable anchor exists — a text-only render is valid.
 */
async function resolveImageRefUrl(
  cell: Cell,
  ctx: RenderContext,
): Promise<string | undefined> {
  if (!cell.anchors || cell.anchors.length === 0) return undefined;

  let anchors: Array<{ id: string; kind: string; asset?: { uri?: string; mime?: string } }>;
  try {
    anchors = readProject(ctx.projectRoot).anchors as typeof anchors;
  } catch {
    return undefined;
  }
  const byId = new Map(anchors.map((a) => [a.id, a]));

  for (const id of cell.anchors) {
    const a = byId.get(id);
    if (!a || !IMAGE_ANCHOR_KINDS.has(a.kind)) continue;
    const uri = a.asset?.uri;
    if (!uri) continue;
    if (/^https?:\/\//i.test(uri)) return uri;

    // Local file — resolve to an absolute path and upload for a fetchable url.
    let abs: string;
    if (uri.startsWith('file://')) abs = fileURLToPath(uri);
    else if (isAbsolute(uri)) abs = uri;
    else abs = resolve(ctx.projectRoot, uri);
    if (!existsSync(abs)) continue;
    try {
      const bytes = readFileSync(abs);
      const blob = new Blob([bytes], { type: a.asset?.mime ?? 'application/octet-stream' });
      return await fal.storage.upload(blob);
    } catch {
      // Upload failed — fall through to a text-only render rather than aborting.
      return undefined;
    }
  }
  return undefined;
}

/**
 * Build the fal model input. Field names are model-dependent and drift; these
 * are the common fal video-model fields. Unknown fields a given model doesn't
 * accept are ignored server-side / surfaced as a validation error the caller
 * sees as a failed render.
 */
function buildVideoInput(args: {
  cell: Cell;
  aspect: AspectRatio;
  imageUrl?: string;
}): Record<string, unknown> {
  const { cell, aspect, imageUrl } = args;
  const input: Record<string, unknown> = { prompt: cell.prompt };
  const negative = readNegativePrompt(cell);
  if (negative) input.negative_prompt = negative;
  if (imageUrl) input.image_url = imageUrl;
  input.aspect_ratio = aspect;
  if (typeof cell.seed === 'number') input.seed = cell.seed;
  if (cell.duration_ms > 0) input.duration = cell.duration_ms / 1000;
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
          'No fal key available (vault `fal.key` / FAL_KEY unset) — render will fail until a key is provided',
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
        '[fal] fal.key not set — provide it via the vault (`fal.key`) or the FAL_KEY env var',
      );
    }
    fal.config({ credentials: key });

    const model = resolveVideoModel(cell, opts);
    const aspect: AspectRatio = opts.aspect_ratio ?? ctx.aspectRatio;
    const imageUrl = await resolveImageRefUrl(cell, ctx);
    const input = buildVideoInput({ cell, aspect, imageUrl });

    const outPath = resolveOutputPath(cell, ctx);

    // Cancellation: race the subscribe against ctx.signal (best-effort — the
    // simple subscribe API exposes no server-side cancel handle).
    let abortReject: ((e: Error) => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      abortReject = reject;
    });
    const onAbort = () => {
      abortReject?.(Object.assign(new Error('[fal] render aborted via ctx.signal'), {
        cancelled: true,
      }));
    };
    if (ctx.signal.aborted) {
      // fire on next tick so the race below is already set up
      queueMicrotask(onAbort);
    } else {
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    }

    let lastMessage = -1;
    const emitProgress = (message: string): void => {
      // De-dupe on message length changes to avoid a flood of identical lines.
      if (message.length === lastMessage) return;
      lastMessage = message.length;
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
      cost_estimate: cost ?? 0,
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
      '[fal] fal.key not set — provide it via keyGetter (vault) or the FAL_KEY env var',
    );
  }
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
