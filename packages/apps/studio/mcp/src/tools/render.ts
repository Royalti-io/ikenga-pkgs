/**
 * `render.*` tools.
 *
 * `render.list_engines` is hard-coded for P1 (HF + Excalidraw) per the brief
 * — when WP-05/WP-05b ship, this list will move to a sidecar-side registry
 * adapters self-register into.
 *
 * `render.status / cancel / list` query the in-memory `RenderShim` from
 * composition.ts; that shim is replaced wholesale once the sidecar grows
 * real queue RPCs.
 */

import type { ToolDef, ToolResult } from './types.js';
import { P1_ENGINE_CAPABILITIES } from './types.js';
import type { RenderShim } from './composition.js';

export function renderTools(shim: RenderShim): ToolDef[] {
  return [
    {
      name: 'render.list_engines',
      description: 'Return the G2 capability matrix for every renderer adapter known to this MCP. No open project required.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async handler() {
        return { ok: true, engines: P1_ENGINE_CAPABILITIES } as ToolResult;
      },
    },
    {
      name: 'render.status',
      description: 'Look up a render record by id (in-memory P1 shim).',
      inputSchema: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
        additionalProperties: false,
      },
      async handler(args) {
        const r = shim.get(args.recordId as string);
        if (!r) return { ok: false, error: 'render-record-not-found', message: `recordId ${args.recordId}` };
        return { ok: true, record: r };
      },
    },
    {
      name: 'render.cancel',
      description: 'Cancel a queued or running render (in-memory P1 shim — flips status to cancelled).',
      inputSchema: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
        additionalProperties: false,
      },
      async handler(args) {
        const ok = shim.cancel(args.recordId as string);
        if (!ok) {
          return { ok: false, error: 'render-cancel-failed', message: 'record missing or already terminal' };
        }
        return { ok: true };
      },
    },
    {
      name: 'render.list',
      description: 'List render records. Optional projectId + status filters.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'done', 'failed', 'cancelled'] },
        },
        additionalProperties: false,
      },
      async handler(args) {
        const records = shim.list({
          projectId: args.projectId as string | undefined,
          status: args.status as
            | 'queued'
            | 'running'
            | 'done'
            | 'failed'
            | 'cancelled'
            | undefined,
        });
        return { ok: true, records };
      },
    },
  ];
}
