/**
 * `asset.*` tools — now LIVE (WP-03b). Forward to the sidecar's asset.*
 * RPCs (files under `<projectRoot>/assets/`).
 */

import { SidecarClient, EXTERNAL_CALL_TIMEOUT_MS } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { ToolDef } from './types.js';

export function assetTools(sidecar: SidecarClient): ToolDef[] {
  return [
    {
      name: 'asset.list',
      description: 'List assets in a project. Optional `kind` filter (image, video, audio, font).',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          kind: { type: 'string' },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'asset.list', { projectId: args.projectId, kind: args.kind }),
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
      // May download from a remote URL inside the RPC; a large file can exceed
      // the 30s default.
      handler: (args) =>
        callSidecar(
          sidecar,
          'asset.import',
          {
            projectId: args.projectId,
            source: args.source,
            kind: args.kind,
          },
          EXTERNAL_CALL_TIMEOUT_MS,
        ),
    },
    {
      name: 'asset.resolve',
      description: 'Resolve an AssetRef (project-relative asset id) to an absolute on-disk path + metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          assetId: { type: 'string' },
        },
        required: ['projectId', 'assetId'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'asset.resolve', { projectId: args.projectId, assetId: args.assetId }),
    },
  ];
}
