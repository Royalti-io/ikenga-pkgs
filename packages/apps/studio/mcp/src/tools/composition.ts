/**
 * `composition.*` tools — now LIVE end-to-end (WP-03b).
 *
 * The in-MCP `RenderShim` is GONE. `composition.render` forwards to the
 * sidecar `render.enqueue` RPC, which owns:
 *   • G23 engine auto-resolution (by content_path extension), and
 *   • G2 capability validation (aspect-ratio / duration) — AT enqueue time,
 *     so a 21:9-on-hyperframes render rejects before reaching the worker.
 * `composition.preview` / `composition.validate` forward to the matching
 * sidecar RPCs, which call the resolved adapter's `preview` / `validate`.
 *
 * No MCP-local engine resolution remains here — the sidecar registry is the
 * single source of truth (G23/G2 enforced at the sidecar boundary, never
 * just in the MCP).
 */

import { SidecarClient } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { OpenProjectRegistry, ToolDef } from './types.js';

export function compositionTools(
  sidecar: SidecarClient,
  _registry: OpenProjectRegistry,
): ToolDef[] {
  return [
    {
      name: 'composition.render',
      description:
        'Enqueue a render for a cell. The sidecar resolves the engine via G23 (auto by content_path extension) and validates against G2 capabilities BEFORE enqueueing. Returns { ok:true, recordId, engine } or a structured failure.',
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
      handler: (args) =>
        callSidecar(sidecar, 'render.enqueue', {
          projectId: args.projectId,
          cellId: args.cellId,
          engine: args.engine,
          variant: args.variant,
          range: args.range,
          aspect_ratio: args.aspect_ratio,
          resolution: args.resolution,
        }),
    },
    {
      name: 'composition.preview',
      description: 'Generate a preview frame URL for a cell. Sidecar resolves the engine (G23) and calls adapter.preview.',
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
      handler: (args) =>
        callSidecar(sidecar, 'composition.preview', {
          projectId: args.projectId,
          cellId: args.cellId,
          engine: args.engine,
        }),
    },
    {
      name: 'composition.validate',
      description: "Run the resolved engine's `validate` against a cell. Returns Diagnostic[] under `diagnostics`.",
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
      handler: (args) =>
        callSidecar(sidecar, 'composition.validate', {
          projectId: args.projectId,
          cellId: args.cellId,
          engine: args.engine,
        }),
    },
  ];
}
