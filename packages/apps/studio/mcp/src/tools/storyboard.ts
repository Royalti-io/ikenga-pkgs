/**
 * `storyboard.*` tools — now LIVE (WP-03b).
 *
 * Every handler forwards to the matching sidecar `storyboard.*` JSON-RPC
 * method via the shared `callSidecar` helper. The sidecar owns the
 * storyboard.json read / atomic-write + Zod re-validation; mutations land on
 * disk and the FS watcher emits `cells/changed`.
 */

import { SidecarClient } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { ToolDef } from './types.js';

export function storyboardTools(sidecar: SidecarClient): ToolDef[] {
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
      handler: (args) => callSidecar(sidecar, 'storyboard.read', { projectId: args.projectId }),
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
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.read_cell', { projectId: args.projectId, cellId: args.cellId }),
    },
    {
      name: 'storyboard.read_fountain',
      description:
        "Read the project's Fountain screenplay source at <root>/script.fountain. Returns { exists, text }. `exists:false` (empty text) means the project has no script.fountain on disk yet — not an error.",
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.read_fountain', { projectId: args.projectId }),
    },
    {
      name: 'storyboard.write_fountain',
      description:
        "Persist the project's Fountain screenplay source to <root>/script.fountain (UTF-8). Replaces the file wholesale — there is no patch-level edit. This is the durable save seam for the Script view's Fountain mode and the Chi authoring flow. Returns { ok, exists, bytes }.",
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['projectId', 'text'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.write_fountain', {
          projectId: args.projectId,
          text: args.text,
        }),
    },
    {
      name: 'storyboard.read_cell_content',
      description:
        "Read a cell's authored source file (the markup at its content_path). Returns { html, content_path, exists }. `exists:false` (empty html) means the cell has no source written yet.",
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
        },
        required: ['projectId', 'cellId'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.read_cell_content', {
          projectId: args.projectId,
          cellId: args.cellId,
        }),
    },
    {
      name: 'storyboard.write_cell_content',
      description:
        "Persist a cell's authored source file (the FULL edited html) to its content_path, atomically (tmp+rename). Does not touch storyboard.json — the project FS watcher observes the content file directly and emits a single cells/changed. This is the durable save seam for the cell editor.",
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          html: { type: 'string' },
        },
        required: ['projectId', 'cellId', 'html'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.write_cell_content', {
          projectId: args.projectId,
          cellId: args.cellId,
          html: args.html,
        }),
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
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.write_cell', { projectId: args.projectId, cell: args.cell }),
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
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.create_cell', { projectId: args.projectId, cell: args.cell }),
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
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.delete_cell', { projectId: args.projectId, cellId: args.cellId }),
    },
    {
      name: 'storyboard.list_cells',
      description: 'List cells in an open project. Optional beat_id + rung filters.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          beat_id: { type: 'string' },
          rung: { type: 'string', enum: ['0_beat_sheet', '1_lofi', '2_hifi'] },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.list_cells', {
          projectId: args.projectId,
          beat_id: args.beat_id,
          rung: args.rung,
        }),
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
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.upsert_beat', { projectId: args.projectId, beat: args.beat }),
    },
    {
      name: 'storyboard.upsert_rung',
      description:
        'Insert or update a per-rung block (beatsheet/lofi/hifi) on a cell. Defaults to the cell\'s own rung when rungKey is omitted.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          cellId: { type: 'string' },
          rung: { type: 'object', additionalProperties: true },
          rungKey: { type: 'string', enum: ['0_beat_sheet', '1_lofi', '2_hifi'] },
        },
        required: ['projectId', 'cellId', 'rung'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.upsert_rung', {
          projectId: args.projectId,
          cellId: args.cellId,
          rung: args.rung,
          rungKey: args.rungKey,
        }),
    },
    {
      name: 'storyboard.reorder_cells',
      description:
        "Reassign Cell.index across the named cells, in the order given. `order` is the FULL sequence, front to back — each named cell's index becomes its position; cells not named are left untouched. One atomic write, so the watcher emits once however many ordinals moved. This is the node canvas's sequence-lane gesture (Plan 25 D-25-5); free 2D placement on the canvas is non-semantic and never calls this. Note: the exporter sorts by time.start first and index second, so this moves the board's ordinals without rewriting composition-absolute times.",
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          order: { type: 'array', items: { type: 'string' } },
        },
        required: ['projectId', 'order'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.reorder_cells', {
          projectId: args.projectId,
          order: args.order,
        }),
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
      handler: (args) =>
        callSidecar(sidecar, 'storyboard.set_approved', {
          projectId: args.projectId,
          cellId: args.cellId,
          approved: args.approved,
        }),
    },
  ];
}
