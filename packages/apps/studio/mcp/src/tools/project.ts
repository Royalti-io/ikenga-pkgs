/**
 * `project.*` tools — thin pass-throughs to the sidecar's project.* RPCs.
 *
 * Every handler funnels through `callSidecar` which converts
 * sidecar-side errors into our `{ ok: false, error, message }` envelope.
 */

import { SidecarClient, SidecarRpcError, SidecarUnavailableError } from '../sidecar-client.js';
import type { OpenProjectRegistry, ToolDef, ToolResult } from './types.js';

export async function callSidecar(
  sidecar: SidecarClient,
  method: string,
  params: unknown,
): Promise<ToolResult> {
  try {
    const r = (await sidecar.call(method, params)) as ToolResult;
    return r;
  } catch (e) {
    if (e instanceof SidecarUnavailableError) {
      return { ok: false, error: 'sidecar-unavailable', message: e.message };
    }
    if (e instanceof SidecarRpcError) {
      return { ok: false, error: 'sidecar-rpc-error', message: `${e.code}: ${e.message}` };
    }
    return { ok: false, error: 'internal-error', message: (e as Error).message };
  }
}

export function projectTools(
  sidecar: SidecarClient,
  registry: OpenProjectRegistry,
): ToolDef[] {
  return [
    {
      name: 'project.open',
      description: 'Open a project on disk. Returns projectId + parsed Project.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or cwd-relative project root path.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async handler(args) {
        const r = await callSidecar(sidecar, 'project.open', { path: args.path });
        if (r.ok) {
          const rec = r as unknown as { projectId?: string; project?: unknown };
          if (typeof rec.projectId === 'string') {
            registry.set(rec.projectId, {
              path: args.path as string,
              project: rec.project,
            });
          }
        }
        return r;
      },
    },
    {
      name: 'project.close',
      description: 'Close an open project; releases its FS watcher + LRU entries.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      async handler(args) {
        const r = await callSidecar(sidecar, 'project.close', { projectId: args.projectId });
        if (r.ok) registry.delete(args.projectId as string);
        return r;
      },
    },
    {
      name: 'project.list',
      description: 'List previously-opened projects (most recent first).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async handler() {
        return callSidecar(sidecar, 'project.list', undefined);
      },
    },
    {
      name: 'project.create',
      description: 'Scaffold a new project on disk from an archetype id, then open it.',
      inputSchema: {
        type: 'object',
        properties: {
          archetype_id: { type: 'string' },
          path: { type: 'string', description: 'Project root directory to create.' },
          name: { type: 'string', description: 'Human-readable project title.' },
        },
        required: ['archetype_id', 'path', 'name'],
        additionalProperties: false,
      },
      async handler(args) {
        const r = await callSidecar(sidecar, 'project.create', {
          archetype_id: args.archetype_id,
          path: args.path,
          name: args.name,
        });
        if (r.ok) {
          const rec = r as unknown as { projectId?: string; project?: unknown };
          if (typeof rec.projectId === 'string') {
            registry.set(rec.projectId, {
              path: args.path as string,
              project: rec.project,
            });
          }
        }
        return r;
      },
    },
    {
      name: 'project.info',
      description: 'Fetch live project info: parsed Project + LRU openCells + queueDepth.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      async handler(args) {
        return callSidecar(sidecar, 'project.info', { projectId: args.projectId });
      },
    },
  ];
}
