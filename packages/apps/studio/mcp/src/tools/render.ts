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
    {
      name: 'render.read_poster',
      description:
        "Read a finished render's poster PNG (extracted when the render finished) off disk, base64-encoded, so the Canvas grid + Composition timeline can show real thumbnails via bytes-over-bridge → blob: (file:// is unloadable from a sandboxed srcdoc pane). Returns { ok:true, base64, mime, sizeBytes, path } or { ok:false, error:'poster-not-found' } when no poster was extracted. Keyed on the render record id.",
      inputSchema: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
        additionalProperties: false,
      },
      handler: (args) => callSidecar(sidecar, 'render.read_poster', { recordId: args.recordId }),
    },
    {
      name: 'render.list_posters',
      description:
        "Batch-read up to 100 finished renders' poster PNGs off disk, base64-encoded, in ONE round-trip — collapses the Canvas grid's per-tile fan-out (N concurrent render.read_poster calls) into a single call. Returns { ok:true, posters: [{ recordId, b64 }] }; b64 is null for a record with no poster yet or an unreadable file — a single missing poster never fails the batch.",
      inputSchema: {
        type: 'object',
        properties: {
          recordIds: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        },
        required: ['recordIds'],
        additionalProperties: false,
      },
      handler: (args) => callSidecar(sidecar, 'render.list_posters', { recordIds: args.recordIds }),
    },
    {
      name: 'render.ingest_external',
      description:
        "Attach a filmmaker's externally-produced clip (mp4/png dropped on disk) to a cell as a done RenderRecord with manual provenance — the return leg of export.prompt_package. Copies the file into renders/<engine>/<rungDir>/<cellUid>.<ext> and writes a terminal 'done' render row so render.list surfaces it exactly like a completed real render. Returns { ok:true, recordId, engine, outputPath, record }.",
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          filePath: {
            type: 'string',
            description: 'Absolute or project-relative path to the mp4/png on disk to ingest.',
          },
          engine: {
            type: 'string',
            description: "Provenance engine, e.g. 'higgsfield' | 'flow' | 'manual'.",
          },
          model_id: { type: 'string', description: 'Optional. Model used to produce the clip.' },
          cost_actual: { type: 'number', description: 'Optional. Actual spend, if known.' },
        },
        required: ['projectId', 'cellId', 'filePath', 'engine'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'render.ingest_external', {
          projectId: args.projectId,
          cellId: args.cellId,
          filePath: args.filePath,
          engine: args.engine,
          model_id: args.model_id,
          cost_actual: args.cost_actual,
        }),
    },
  ];
}
