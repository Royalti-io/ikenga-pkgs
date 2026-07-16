/**
 * `anchor.*` tools — now LIVE (WP-03b). Forward to the sidecar's anchor.*
 * RPCs, which mutate the project-level `Project.anchors[]` array in
 * storyboard.json (atomic write; watcher emits cells/changed).
 */

import { SidecarClient, EXTERNAL_CALL_TIMEOUT_MS } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { ToolDef } from './types.js';

export function anchorTools(sidecar: SidecarClient): ToolDef[] {
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
      handler: (args) => callSidecar(sidecar, 'anchor.list', { projectId: args.projectId }),
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
      handler: (args) =>
        callSidecar(sidecar, 'anchor.create', { projectId: args.projectId, anchor: args.anchor }),
    },
    {
      name: 'anchor.generate',
      description:
        'Generate a reference plate via fal (still image) and store it as a project anchor ' +
        '(character/location/style/image locking). Requires FAL_KEY in the sidecar env.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          kind: { type: 'string', enum: ['character', 'location', 'style', 'image'] },
          name: { type: 'string' },
          prompt: { type: 'string' },
          seed: { type: 'number' },
          model: { type: 'string', description: 'Optional fal image model id override.' },
        },
        required: ['projectId', 'kind', 'name', 'prompt'],
        additionalProperties: false,
      },
      // Blocks on a fal.ai still-image round-trip inside the RPC; a cold call
      // can exceed the 30s default.
      handler: (args) =>
        callSidecar(
          sidecar,
          'anchor.generate',
          {
            projectId: args.projectId,
            kind: args.kind,
            name: args.name,
            prompt: args.prompt,
            seed: args.seed,
            model: args.model,
          },
          EXTERNAL_CALL_TIMEOUT_MS,
        ),
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
      handler: (args) =>
        callSidecar(sidecar, 'anchor.delete', { projectId: args.projectId, anchorId: args.anchorId }),
    },
  ];
}
