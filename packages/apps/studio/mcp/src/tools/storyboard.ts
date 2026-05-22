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
