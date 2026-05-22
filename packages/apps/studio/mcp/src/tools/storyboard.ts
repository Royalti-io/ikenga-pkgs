/**
 * `storyboard.*` tools.
 *
 * The WP-03 sidecar does NOT implement these yet — they ship in a future
 * WP (likely WP-11 / WP-12 once storyboard FS writes land). For P1 we
 * return a structured `sidecar-method-not-implemented` envelope so the
 * iframe and the agent get a deterministic, parseable failure instead of
 * a `methodNotFound` JSON-RPC error.
 */

import type { ToolDef, ToolResult } from './types.js';

const STUB_WP = 'WP-?'; // unknown until storyboard FS writes are scheduled

function stub(method: string): ToolResult {
  return {
    ok: false,
    error: 'sidecar-method-not-implemented',
    message: `${method} ships in ${STUB_WP}`,
  };
}

export function storyboardTools(): ToolDef[] {
  return [
    {
      name: 'storyboard.read',
      description: 'Read the full storyboard for an open project. Returns the parsed Project + cell index.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.read');
      },
    },
    {
      name: 'storyboard.read_cell',
      description: 'Read a single cell by id.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
        },
        required: ['projectId', 'cellId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.read_cell');
      },
    },
    {
      name: 'storyboard.write_cell',
      description: 'Overwrite a cell. Emits cells/changed on success.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cell: { type: 'object', additionalProperties: true },
        },
        required: ['projectId', 'cell'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.write_cell');
      },
    },
    {
      name: 'storyboard.create_cell',
      description: 'Create a new cell. Emits cells/changed on success.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cell: { type: 'object', additionalProperties: true },
        },
        required: ['projectId', 'cell'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.create_cell');
      },
    },
    {
      name: 'storyboard.delete_cell',
      description: 'Delete a cell by id.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
        },
        required: ['projectId', 'cellId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.delete_cell');
      },
    },
    {
      name: 'storyboard.list_cells',
      description: 'List cells in an open project.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.list_cells');
      },
    },
    {
      name: 'storyboard.upsert_beat',
      description: 'Insert or update a beat (script-level) on the project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          beat: { type: 'object', additionalProperties: true },
        },
        required: ['projectId', 'beat'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.upsert_beat');
      },
    },
    {
      name: 'storyboard.upsert_rung',
      description: 'Insert or update a per-rung block (beatsheet/lofi/hifi) on a cell.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          rung: { type: 'object', additionalProperties: true },
        },
        required: ['projectId', 'cellId', 'rung'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.upsert_rung');
      },
    },
    {
      name: 'storyboard.set_approved',
      description: 'Flip the approved boolean on a cell.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          approved: { type: 'boolean' },
        },
        required: ['projectId', 'cellId', 'approved'],
        additionalProperties: false,
      },
      async handler() {
        return stub('storyboard.set_approved');
      },
    },
  ];
}
