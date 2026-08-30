/**
 * `canvas.*` tools (Plan 25 / G-76) — the authored canvas layout store.
 *
 * Additive surface: nothing that existed before changed shape. Both handlers
 * forward to the matching sidecar `canvas.*` JSON-RPC method, which owns the
 * `<projectRoot>/.studio/canvas.json` read + atomic write and the Zod
 * re-validation. The FS watcher already carries `.studio/**`, so a write emits
 * exactly one `cells/changed` — layout is live across panes and machines, the
 * thing browser localStorage could never be.
 */

import { SidecarClient } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { ToolDef } from './types.js';

export function canvasTools(sidecar: SidecarClient): ToolDef[] {
  return [
    {
      name: 'canvas.read',
      description:
        "Read the project's AUTHORED node-canvas document at <root>/.studio/canvas.json — node placements, groups, collapse state, sequence-lane state, viewport and orphan tombstones. Returns { exists, doc }. `exists:false` (doc null) means this project has never been arranged; that is a normal state, not an error. Derived material (nodes, edges, lane defaults) is NEVER stored here — it is recomputed from storyboard.json / script.fountain on every read.",
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: (args) => callSidecar(sidecar, 'canvas.read', { projectId: args.projectId }),
    },
    {
      name: 'canvas.write',
      description:
        "Persist the project's authored node-canvas document to <root>/.studio/canvas.json, atomically (tmp+rename, one watcher event). Replaces the document wholesale — read, amend, write back. Never touches storyboard.json: layout must survive an agent rewriting the board. Returns { path, bytes, doc }.",
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          doc: { type: 'object', additionalProperties: true },
        },
        required: ['projectId', 'doc'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'canvas.write', { projectId: args.projectId, doc: args.doc }),
    },
  ];
}
