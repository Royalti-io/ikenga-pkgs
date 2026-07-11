// com.ikenga.studio · render/export polling helpers
//
// The shell has no host→iframe relay for pkg:// events (ext-apps SDK
// limitation — Round-13 Finding), so real mode can't receive the
// render/progress|render/done notifications the mock emits. These helpers
// POLL render.status / export.status instead, reusing roughly the mock's
// cadence. They are the ONLY place the poll lives — a future event relay
// replaces the body of the loop without touching call sites (Composition/Cell
// just await the returned promise / read the onTick callback).

import { renderApi, exportApi, type McpClient } from '../mcp-client';
import type { RenderRecord, ExportRecord } from '../mcp-types';

const RENDER_TERMINAL = new Set<RenderRecord['status']>(['done', 'failed', 'cancelled']);
const EXPORT_TERMINAL = new Set<ExportRecord['status']>(['done', 'failed']);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll render.status for a record until it reaches a terminal state (done /
 * failed / cancelled) or the timeout elapses. `onTick` fires on every poll so
 * the UI can reflect queued→running→done live. Returns the final record, or
 * null if the status call itself failed. In mock mode render.status returns
 * `done` on the first tick, so this resolves immediately there.
 */
export async function pollRenderUntilDone(
  client: McpClient,
  recordId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (rec: RenderRecord) => void; signal?: { aborted: boolean } } = {},
): Promise<RenderRecord | null> {
  const intervalMs = opts.intervalMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const start = Date.now();
  for (;;) {
    if (opts.signal?.aborted) return null;
    let rec: RenderRecord;
    try {
      rec = await renderApi.status(client, recordId);
    } catch {
      return null;
    }
    opts.onTick?.(rec);
    if (RENDER_TERMINAL.has(rec.status)) return rec;
    if (Date.now() - start > timeoutMs) return rec;
    await sleep(intervalMs);
  }
}

/**
 * Poll export.status for an export until terminal (done / failed) or timeout.
 * Same contract as pollRenderUntilDone. In mock mode export.status returns
 * `done` immediately.
 */
export async function pollExportUntilDone(
  client: McpClient,
  exportId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (rec: ExportRecord) => void; signal?: { aborted: boolean } } = {},
): Promise<ExportRecord | null> {
  const intervalMs = opts.intervalMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const start = Date.now();
  for (;;) {
    if (opts.signal?.aborted) return null;
    let rec: ExportRecord;
    try {
      rec = await exportApi.status(client, exportId);
    } catch {
      return null;
    }
    opts.onTick?.(rec);
    if (EXPORT_TERMINAL.has(rec.status)) return rec;
    if (Date.now() - start > timeoutMs) return rec;
    await sleep(intervalMs);
  }
}
