/**
 * `composition.*` tools.
 *
 * G23 (engine auto-resolution) and G2 (capability validation) live HERE,
 * AT enqueue time — never after a failed render round-trip. The brief is
 * explicit: reject up-front so the agent doesn't burn a render slot on a
 * combo we already know is invalid.
 *
 * P1 in-memory render shim (read this carefully):
 * ─────────────────────────────────────────────
 *  The real SQLite render queue lives in the sidecar (queue.ts → render_queue
 *  table). The sidecar does NOT yet expose enqueue/status/cancel RPCs —
 *  those land in a later WP. To make the brief's smoke #5 testable today,
 *  this module keeps an in-memory `Map<recordId, RenderShimRecord>` so that
 *  `composition.render` → `{ok:true, recordId}` and `render.list/status/cancel`
 *  can correlate against it. The shim is replaced wholesale the moment the
 *  sidecar grows real RPCs.
 */

import { randomUUID } from 'node:crypto';

import type { SidecarClient } from '../sidecar-client.js';
import type { OpenProjectRegistry, ToolDef, ToolResult } from './types.js';
import { P1_ENGINE_CAPABILITIES, resolveEngineForContentPath } from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// In-memory render shim (P1 only)
// ─────────────────────────────────────────────────────────────────────────

export interface RenderShimRecord {
  recordId: string;
  projectId: string;
  cellId: string;
  engine: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  enqueuedAt: number;
  aspect_ratio?: string;
  variant?: string;
}

export class RenderShim {
  private records = new Map<string, RenderShimRecord>();
  enqueue(args: Omit<RenderShimRecord, 'recordId' | 'status' | 'enqueuedAt'>): RenderShimRecord {
    const rec: RenderShimRecord = {
      ...args,
      recordId: randomUUID(),
      status: 'queued',
      enqueuedAt: Date.now(),
    };
    this.records.set(rec.recordId, rec);
    return rec;
  }
  get(recordId: string): RenderShimRecord | undefined {
    return this.records.get(recordId);
  }
  list(filter: { projectId?: string; status?: RenderShimRecord['status'] } = {}): RenderShimRecord[] {
    return [...this.records.values()].filter((r) => {
      if (filter.projectId && r.projectId !== filter.projectId) return false;
      if (filter.status && r.status !== filter.status) return false;
      return true;
    });
  }
  cancel(recordId: string): boolean {
    const r = this.records.get(recordId);
    if (!r) return false;
    if (r.status === 'done' || r.status === 'failed' || r.status === 'cancelled') return false;
    r.status = 'cancelled';
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Look up the engine's capabilities. Returns the entry or null.
 */
function findEngine(engineId: string) {
  return P1_ENGINE_CAPABILITIES.find((e) => e.id === engineId) ?? null;
}

/**
 * Read a cell from the (already-open) project by id. Returns the cell or
 * null. Reads the on-disk `storyboard.json` since the WP-03 sidecar's LRU
 * is not exposed over RPC and we don't want to add an RPC dependency.
 */
async function readCellFromProjectFs(
  projectRoot: string,
  cellId: string,
): Promise<{ content_path?: string; uid?: string } | null> {
  // Defer to dynamic import so this module stays cheap at MCP boot.
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sbPath = join(projectRoot, 'storyboard.json');
  if (!existsSync(sbPath)) return null;
  try {
    const body = JSON.parse(readFileSync(sbPath, 'utf8')) as {
      cells?: Array<{ uid?: string; content_path?: string }>;
    };
    const cells = body.cells ?? [];
    return cells.find((c) => c.uid === cellId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate G2 against an engine's capabilities. Returns null on pass, or
 * a structured failure result on reject.
 */
function checkG2(
  engineId: string,
  opts: { aspect_ratio?: string; duration_ms?: number },
): ToolResult | null {
  const eng = findEngine(engineId);
  if (!eng) {
    return { ok: false, error: 'unresolvable-engine', message: `unknown engine ${engineId}` };
  }
  if (opts.aspect_ratio && !eng.capabilities.aspect_ratios.includes(opts.aspect_ratio as never)) {
    return {
      ok: false,
      error: 'unsupported-aspect-ratio',
      message: `engine ${engineId} does not support ${opts.aspect_ratio}; supported: ${eng.capabilities.aspect_ratios.join(',')}`,
    };
  }
  if (
    opts.duration_ms != null &&
    eng.capabilities.max_duration_ms != null &&
    opts.duration_ms > eng.capabilities.max_duration_ms
  ) {
    return {
      ok: false,
      error: 'duration-exceeds-cap',
      message: `engine ${engineId} caps at ${eng.capabilities.max_duration_ms}ms; requested ${opts.duration_ms}ms`,
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────

export function compositionTools(
  _sidecar: SidecarClient,
  registry: OpenProjectRegistry,
  shim: RenderShim,
): ToolDef[] {
  return [
    {
      name: 'composition.render',
      description:
        'Enqueue a render for a cell. Resolves engine via G23 (auto by content_path extension) and validates against G2 capabilities BEFORE enqueueing. Returns { ok:true, recordId } or a structured failure.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          engine: { type: 'string', description: 'Optional. "auto" or undefined triggers G23 resolution.' },
          variant: { type: 'string' },
          range: {
            type: 'object',
            properties: { start_ms: { type: 'number' }, end_ms: { type: 'number' } },
            additionalProperties: false,
          },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
          resolution: {
            type: 'object',
            properties: { w: { type: 'number' }, h: { type: 'number' } },
            required: ['w', 'h'],
            additionalProperties: false,
          },
        },
        required: ['projectId', 'cellId'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string;
        const cellId = args.cellId as string;
        const proj = registry.get(projectId);
        if (!proj) {
          return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
        }
        const cell = await readCellFromProjectFs(proj.path, cellId);
        if (!cell) {
          return { ok: false, error: 'cell-not-found', message: `cell ${cellId} not found in ${projectId}` };
        }

        // G23 — resolve engine.
        const resolved = resolveEngineForContentPath(cell.content_path, args.engine as string | undefined);
        if (!resolved.ok) return resolved;

        // G2 — capability gate.
        const g2 = checkG2(resolved.engine, {
          aspect_ratio: args.aspect_ratio as string | undefined,
          duration_ms:
            args.range && typeof (args.range as Record<string, unknown>).end_ms === 'number'
              ? ((args.range as { end_ms: number }).end_ms -
                  ((args.range as { start_ms?: number }).start_ms ?? 0))
              : undefined,
        });
        if (g2) return g2;

        // Enqueue (P1 in-memory shim).
        const rec = shim.enqueue({
          projectId,
          cellId,
          engine: resolved.engine,
          aspect_ratio: args.aspect_ratio as string | undefined,
          variant: args.variant as string | undefined,
        });
        return { ok: true, recordId: rec.recordId, engine: resolved.engine };
      },
    },
    {
      name: 'composition.preview',
      description: 'Generate a preview frame URL for a cell. Same G23+G2 resolution as render.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          engine: { type: 'string' },
        },
        required: ['projectId', 'cellId'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string;
        const cellId = args.cellId as string;
        const proj = registry.get(projectId);
        if (!proj) {
          return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
        }
        const cell = await readCellFromProjectFs(proj.path, cellId);
        if (!cell) {
          return { ok: false, error: 'cell-not-found', message: `cell ${cellId} not found in ${projectId}` };
        }
        const resolved = resolveEngineForContentPath(cell.content_path, args.engine as string | undefined);
        if (!resolved.ok) return resolved;
        return {
          ok: false,
          error: 'sidecar-method-not-implemented',
          message: 'composition.preview ships in WP-? (adapter integration)',
        };
      },
    },
    {
      name: 'composition.validate',
      description: 'Run the resolved engine\'s `validate` against a cell. Returns Diagnostic[] under `diagnostics`.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          engine: { type: 'string' },
        },
        required: ['projectId', 'cellId'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string;
        const cellId = args.cellId as string;
        const proj = registry.get(projectId);
        if (!proj) {
          return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
        }
        const cell = await readCellFromProjectFs(proj.path, cellId);
        if (!cell) {
          return { ok: false, error: 'cell-not-found', message: `cell ${cellId} not found in ${projectId}` };
        }
        const resolved = resolveEngineForContentPath(cell.content_path, args.engine as string | undefined);
        if (!resolved.ok) return resolved;
        return {
          ok: false,
          error: 'sidecar-method-not-implemented',
          message: 'composition.validate ships in WP-? (adapter integration)',
        };
      },
    },
  ];
}
