/**
 * `render.*` tools — now LIVE against the sidecar queue (WP-03b).
 *
 * `render.list_engines` sources the G2 capability matrix from the sidecar
 * registry (`render.list_engines` RPC) instead of the old hardcoded P1
 * array — the response shape is unchanged (`{ ok, engines: [{id, capabilities}] }`)
 * so WP-07's eventual swap is unaffected.
 *
 * `render.status / cancel / list` query the sidecar's SQLite render_queue
 * (the in-memory RenderShim is gone).
 */

import { SidecarClient } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { ToolDef } from './types.js';

export function renderTools(sidecar: SidecarClient): ToolDef[] {
  return [
    {
      name: 'render.list_engines',
      description: 'Return the G2 capability matrix for every renderer adapter known to the sidecar registry. No open project required.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => callSidecar(sidecar, 'render.list_engines', {}),
    },
    {
      name: 'render.status',
      description: 'Look up a render record by id from the sidecar queue.',
      inputSchema: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
        additionalProperties: false,
      },
      handler: (args) => callSidecar(sidecar, 'render.status', { recordId: args.recordId }),
    },
    {
      name: 'render.cancel',
      description: 'Cancel a queued or running render (aborts the in-flight adapter or marks a queued row cancelled).',
      inputSchema: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
        additionalProperties: false,
      },
      handler: (args) => callSidecar(sidecar, 'render.cancel', { recordId: args.recordId }),
    },
    {
      name: 'render.list',
      description: 'List render records from the sidecar queue. Optional projectId + status filters.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'done', 'failed', 'cancelled'] },
        },
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'render.list', { projectId: args.projectId, status: args.status }),
    },
    {
      name: 'render.read_bytes',
      description:
        "Read a finished render's MP4 off disk, base64-encoded, so a UI can preview it as a blob: URL in-pane (file:// is unloadable from a sandboxed srcdoc pane). Returns { ok:true, base64, mime, sizeBytes, path }. Keyed on the render record id.",
      inputSchema: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
        additionalProperties: false,
      },
      handler: (args) => callSidecar(sidecar, 'render.read_bytes', { recordId: args.recordId }),
    },
  ];
}
