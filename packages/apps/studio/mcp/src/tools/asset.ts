/**
 * `asset.*` tools — stubbed against the WP-03 sidecar (no asset RPCs yet).
 */

import type { ToolDef, ToolResult } from './types.js';

function stub(method: string): ToolResult {
  return {
    ok: false,
    error: 'sidecar-method-not-implemented',
    message: `${method} ships in WP-?`,
  };
}

export function assetTools(): ToolDef[] {
  return [
    {
      name: 'asset.list',
      description: 'List assets in a project. Optional `kind` filter (image, video, audio, etc.).',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          kind: { type: 'string' },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('asset.list');
      },
    },
    {
      name: 'asset.import',
      description: 'Import an asset from a URL or local path into the project assets dir.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          source: { type: 'string', description: 'URL or absolute path of the source asset.' },
          kind: { type: 'string' },
        },
        required: ['projectId', 'source'],
        additionalProperties: false,
      },
      async handler() {
        return stub('asset.import');
      },
    },
    {
      name: 'asset.resolve',
      description: 'Resolve an AssetRef to an absolute on-disk path + URL.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          assetId: { type: 'string' },
        },
        required: ['projectId', 'assetId'],
        additionalProperties: false,
      },
      async handler() {
        return stub('asset.resolve');
      },
    },
  ];
}
