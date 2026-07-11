/**
 * Render queue EXECUTION (WP-03b).
 *
 * WP-03 created the `render_queue` SQLite table but nothing ran it. This
 * module is the worker: it resolves the engine (G23) + capability-checks
 * (G2) at enqueue, inserts a `queued` row, and an on-enqueue-triggered loop
 * dequeues → builds a `RenderContext` → calls `adapter.render` → persists
 * `running`/`done`/`failed`/`cancelled` transitions → emits `render/progress`
 * (forwarded from the adapter's `ctx.emit`) and `render/done`.
 *
 * Concurrency model: a single in-process worker drains the queue serially
 * (one render at a time). The sidecar is single-process and HF/Excalidraw
 * each saturate a Chrome + FFmpeg, so serial is the right P1 default and
 * keeps the queue semantics trivial. `kick()` is idempotent — calling it
 * while the worker is busy is a no-op; the worker re-checks the queue when
 * it finishes each job.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_RESOLUTION,
  rungDir,
  type AspectRatio,
  type Cell,
} from '@ikenga/studio-schema';

import {
  enqueue as dbEnqueue,
  listQueue,
  markDone,
  markStarted,
  mimeForPath,
} from './queue.js';
import type { RenderQueueRow } from './db.js';
import {
  emitRenderDone,
  emitRenderProgress,
  type EventWriter,
} from './events.js';
import {
  EngineResolutionError,
  getAdapter,
  resolveEngineWithRequest,
} from './registry.js';
import type { RenderContext, RenderOptions } from './renderers/types.js';

type Db = Parameters<typeof markStarted>[0];

/** Per-project context the runner needs to build a RenderContext + find cells. */
export interface ProjectLookup {
  /** Return the absolute project root for an open project, or undefined. */
  projectRoot(projectId: string): string | undefined;
  /** Return a cell by uid from the open project's in-memory document, or undefined. */
  cell(projectId: string, cellId: string): Cell | undefined;
  /** Project-default aspect ratio. */
  aspectRatio(projectId: string): AspectRatio | undefined;
  /** Project-default resolution (already derived from aspect when absent on disk). */
  resolution(projectId: string): { w: number; h: number } | undefined;
}

export interface RenderRunnerDeps {
  db: Db;
  lookup: ProjectLookup;
  writer: EventWriter;
}

export interface EnqueueOptions extends RenderOptions {
  engine?: string;
  range?: { start_ms?: number; end_ms?: number };
}

export type EnqueueResult =
  | { ok: true; recordId: string; engine: string }
  | { ok: false; error: string; message?: string };

/**
 * The runner owns the AbortControllers for in-flight renders so `cancel`
 * can abort the right one. Keyed by recordId.
 */
export class RenderRunner {
  private readonly db: Db;
  private readonly lookup: ProjectLookup;
  private readonly writer: EventWriter;
  private readonly controllers = new Map<string, AbortController>();
  private draining = false;

  constructor(deps: RenderRunnerDeps) {
    this.db = deps.db;
    this.lookup = deps.lookup;
    this.writer = deps.writer;
  }

  /** Recover from a restart: any `running` rows are stale — re-queue them. */
  recover(): void {
    const rows = listQueue(this.db);
    for (const row of rows) {
      if (row.status === 'running') {
        this.db
          .prepare(`UPDATE render_queue SET status = 'queued', started_at = NULL WHERE record_id = ?`)
          .run(row.record_id);
      }
    }
    this.kick();
  }

  /**
   * G23 engine resolution + G2 capability gate, then insert a `queued` row.
   * Rejections happen HERE (at enqueue), mirroring WP-06's in-MCP shim — so a
   * 21:9-on-hyperframes render never reaches the worker.
   */
  enqueue(projectId: string, cellId: string, opts: EnqueueOptions = {}): EnqueueResult {
    const root = this.lookup.projectRoot(projectId);
    if (!root) {
      return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
    }
    const cell = this.lookup.cell(projectId, cellId);
    if (!cell) {
      return { ok: false, error: 'cell-not-found', message: `cell ${cellId} not found in ${projectId}` };
    }

    // G23 — resolve engine from content_path (honoring an explicit pick).
    let engine: string;
    try {
      engine = resolveEngineWithRequest(cell.content_path, opts.engine);
    } catch (e) {
      if (e instanceof EngineResolutionError) {
        return { ok: false, error: e.code, message: e.message };
      }
      return { ok: false, error: 'internal-error', message: (e as Error).message };
    }

    const adapter = getAdapter(engine);
    if (!adapter) {
      return { ok: false, error: 'unresolvable-engine', message: `no adapter for ${engine}` };
    }

    // G2 — capability gate against the resolved adapter.
    const aspect = opts.aspect_ratio;
    if (aspect && !adapter.capabilities.aspect_ratios.includes(aspect)) {
      return {
        ok: false,
        error: 'unsupported-aspect-ratio',
        message: `engine ${engine} does not support ${aspect}; supported: ${adapter.capabilities.aspect_ratios.join(',')}`,
      };
    }
    const durationMs =
      opts.range && typeof opts.range.end_ms === 'number'
        ? opts.range.end_ms - (opts.range.start_ms ?? 0)
        : undefined;
    if (
      durationMs != null &&
      adapter.capabilities.max_duration_ms != null &&
      durationMs > adapter.capabilities.max_duration_ms
    ) {
      return {
        ok: false,
        error: 'duration-exceeds-cap',
        message: `engine ${engine} caps at ${adapter.capabilities.max_duration_ms}ms; requested ${durationMs}ms`,
      };
    }

    const recordId = randomUUID();
    dbEnqueue(this.db, {
      recordId,
      projectId,
      cellId,
      engine,
      options: {
        aspect_ratio: opts.aspect_ratio,
        resolution: opts.resolution,
        variant: opts.variant,
        range: opts.range,
      },
    });
    this.kick();
    return { ok: true, recordId, engine };
  }

  status(recordId: string): { ok: true; record: RenderQueueRow } | { ok: false; error: string; message?: string } {
    const row = this.db
      .prepare(`SELECT * FROM render_queue WHERE record_id = ?`)
      .get(recordId) as RenderQueueRow | undefined;
    if (!row) return { ok: false, error: 'render-record-not-found', message: recordId };
    return { ok: true, record: row };
  }

  cancel(recordId: string): { ok: true } | { ok: false; error: string; message?: string } {
    const row = this.db
      .prepare(`SELECT * FROM render_queue WHERE record_id = ?`)
      .get(recordId) as RenderQueueRow | undefined;
    if (!row) return { ok: false, error: 'render-record-not-found', message: recordId };
    if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') {
      return { ok: false, error: 'render-cancel-failed', message: 'record already terminal' };
    }
    const ctrl = this.controllers.get(recordId);
    if (ctrl) {
      // Running — abort the adapter; the worker tags it cancelled on throw.
      ctrl.abort();
    } else {
      // Still queued — mark cancelled directly so the worker skips it.
      markDone(this.db, recordId, 'cancelled');
      this.emitDone(row, 'cancelled');
    }
    return { ok: true };
  }

  list(filter: { projectId?: string; status?: string } = {}): { ok: true; records: RenderQueueRow[] } {
    let rows = listQueue(this.db, filter.projectId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    return { ok: true, records: rows };
  }

  /**
   * Read a finished render's MP4 off disk and return it base64-encoded so the
   * UI iframe can preview it as a `blob:` URL. A `file://` path is unloadable
   * from a null-origin srcdoc pane (WebKitGTK) and the pkg-content HTTP route
   * only serves `dist/`, so bytes-over-the-bridge → Blob is the one seam that
   * plays real pixels+audio in-pane (playback-seam probe, Wave-2). Keyed on
   * the render record id (not an arbitrary path) so it can't read outside the
   * queue's own outputs.
   */
  readBytes(recordId: string):
    | { ok: true; base64: string; mime: string; sizeBytes: number; path: string }
    | { ok: false; error: string; message?: string } {
    const row = this.db
      .prepare(`SELECT * FROM render_queue WHERE record_id = ?`)
      .get(recordId) as RenderQueueRow | undefined;
    if (!row) return { ok: false, error: 'render-record-not-found', message: recordId };
    if (!row.output_path) return { ok: false, error: 'render-not-done', message: 'no output on disk yet' };
    if (!existsSync(row.output_path)) return { ok: false, error: 'render-output-missing', message: row.output_path };
    try {
      const buf = readFileSync(row.output_path);
      return {
        ok: true,
        base64: buf.toString('base64'),
        mime: mimeForPath(row.output_path),
        sizeBytes: buf.length,
        path: row.output_path,
      };
    } catch (e) {
      return { ok: false, error: 'render-read-failed', message: (e as Error).message };
    }
  }

  /** Kick the drain loop (idempotent). */
  kick(): void {
    if (this.draining) return;
    this.draining = true;
    // Defer to a microtask/tick so enqueue returns before work starts.
    void this.drain().finally(() => {
      this.draining = false;
      // If something was enqueued during the last job, re-check.
      const pending = this.db
        .prepare(`SELECT COUNT(*) AS n FROM render_queue WHERE status = 'queued'`)
        .get() as { n: number };
      if ((pending?.n ?? 0) > 0) this.kick();
    });
  }

  private nextQueued(): RenderQueueRow | undefined {
    return this.db
      .prepare(`SELECT * FROM render_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as RenderQueueRow | undefined;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const row = this.nextQueued();
      if (!row) return;
      await this.runOne(row);
    }
  }

  private async runOne(row: RenderQueueRow): Promise<void> {
    const adapter = getAdapter(row.engine);
    if (!adapter) {
      markDone(this.db, row.record_id, 'failed', { error: `no adapter for ${row.engine}` });
      this.emitDone(row, 'failed', undefined, `no adapter for ${row.engine}`);
      return;
    }

    const root = this.lookup.projectRoot(row.project_id);
    const cell = this.lookup.cell(row.project_id, row.cell_id);
    if (!root || !cell) {
      const msg = !root ? 'project not open' : `cell ${row.cell_id} not found`;
      markDone(this.db, row.record_id, 'failed', { error: msg });
      this.emitDone(row, 'failed', undefined, msg);
      return;
    }

    let opts: EnqueueOptions = {};
    try {
      opts = JSON.parse(row.options) as EnqueueOptions;
    } catch {
      opts = {};
    }

    const aspect: AspectRatio = opts.aspect_ratio ?? this.lookup.aspectRatio(row.project_id) ?? '16:9';
    const resolution =
      opts.resolution ?? this.lookup.resolution(row.project_id) ?? DEFAULT_RESOLUTION[aspect];

    const cellDir = dirname(absContentPath(root, cell));
    const rendersDir = join(root, 'renders');
    if (!existsSync(rendersDir)) mkdirSync(rendersDir, { recursive: true });

    const controller = new AbortController();
    this.controllers.set(row.record_id, controller);

    const ctx: RenderContext = {
      projectRoot: root,
      cellDir,
      rendersDir,
      aspectRatio: aspect,
      resolution,
      vault: { get: async () => undefined }, // no vault outside the shell (P1 deterministic engines need none)
      emit: (event) => {
        // Forward the adapter's render.progress events onto the pkg event bus.
        const p = (event.payload ?? {}) as {
          recordId?: string;
          cellId?: string;
          engine?: string;
          progress?: number | null;
          frame?: number;
        };
        emitRenderProgress(this.writer, row.project_id, {
          recordId: p.recordId ?? row.record_id,
          cellId: p.cellId ?? row.cell_id,
          engine: p.engine ?? row.engine,
          progress: typeof p.progress === 'number' ? p.progress : 0,
          frame: p.frame,
        });
      },
      signal: controller.signal,
    };

    markStarted(this.db, row.record_id);

    const renderOpts: RenderOptions = {
      aspect_ratio: opts.aspect_ratio,
      resolution: opts.resolution,
      variant: opts.variant,
    };

    try {
      const record = await adapter.render(cell, renderOpts, ctx);
      const outputPath = record.output?.uri;
      markDone(this.db, row.record_id, 'done', { outputPath });
      this.emitDone(row, 'done', outputPath);
    } catch (e) {
      const cancelled = (e as Error & { cancelled?: boolean }).cancelled === true || controller.signal.aborted;
      if (cancelled) {
        markDone(this.db, row.record_id, 'cancelled');
        this.emitDone(row, 'cancelled');
      } else {
        const msg = (e as Error).message;
        markDone(this.db, row.record_id, 'failed', { error: msg });
        this.emitDone(row, 'failed', undefined, msg);
      }
    } finally {
      this.controllers.delete(row.record_id);
    }
  }

  private emitDone(
    row: RenderQueueRow,
    status: 'done' | 'failed' | 'cancelled',
    outputPath?: string,
    error?: string,
  ): void {
    emitRenderDone(this.writer, row.project_id, {
      recordId: row.record_id,
      cellId: row.cell_id,
      engine: row.engine,
      status,
      outputPath,
      error,
    });
  }
}

function absContentPath(projectRoot: string, cell: Cell): string {
  return isAbsolute(cell.content_path) ? cell.content_path : resolve(projectRoot, cell.content_path);
}

/** Compute the expected output path for a hyperframes/excalidraw render (for smoke assertions). */
export function expectedRenderPath(rendersDir: string, engine: string, cell: Cell): string {
  return join(rendersDir, engine, rungDir(cell.rung), `${cell.uid}.mp4`);
}
