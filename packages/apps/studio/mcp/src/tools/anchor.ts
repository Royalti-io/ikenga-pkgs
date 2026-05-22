/**
 * `anchor.*` tools — stubbed against the WP-03 sidecar (no anchor RPCs yet).
 */

import type { ToolDef, ToolResult } from './types.js';

function stub(method: string): ToolResult {
  return {
    ok: false,
    error: 'sidecar-method-not-implemented',
    message: `${method} ships in WP-?`,
  };
}

export function anchorTools(): ToolDef[] {
  return [
    {
      name: 'anchor.list',
      description: 'List all anchors in the project.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('anchor.list');
      },
    },
    {
      name: 'anchor.create',
      description: 'Create a new anchor (project-scoped reusable asset reference).',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          anchor: { type: 'object', additionalProperties: true },
        },
        required: ['projectId', 'anchor'],
        additionalProperties: false,
      },
      async handler() {
        return stub('anchor.create');
      },
    },
    {
      name: 'anchor.delete',
      description: 'Delete an anchor by id.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          anchorId: { type: 'string' },
        },
        required: ['projectId', 'anchorId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('anchor.delete');
      },
    },
  ];
}
