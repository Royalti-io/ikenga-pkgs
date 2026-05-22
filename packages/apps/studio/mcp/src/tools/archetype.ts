/**
 * `archetype.*` tools — catalog-backed (no open project required for list/get).
 *
 * `archetype.instantiate_into_project` scaffolds a known archetype into an
 * already-open project. WP-03b wired it to the sidecar's in-place scaffold
 * RPC, which materializes the archetype chain into the project cells. When
 * no archetype definition is found yet, the sidecar returns the honest
 * domain error `archetype-not-found` (definitions ship in WP-09) — never a
 * not-implemented stub.
 */

import type { Catalog } from '../catalog.js';
import { SidecarClient } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { OpenProjectRegistry, ToolDef } from './types.js';

export function archetypeTools(
  catalog: Catalog,
  registry: OpenProjectRegistry,
  sidecar: SidecarClient,
): ToolDef[] {
  return [
    {
      name: 'archetype.list',
      description: 'List archetypes in the catalog. Project-scoped custom archetypes merge in when projectId is supplied.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          const open = registry.get(projectId);
          if (open) catalog.refreshForProject(projectId, open.path);
        }
        const archetypes = catalog.listArchetypes({ projectId });
        return {
          ok: true,
          archetypes: archetypes.map((a) => ({
            archetype_id: a.archetype_id,
            name: a.name,
            source: a.source,
          })),
        };
      },
    },
    {
      name: 'archetype.get',
      description: 'Fetch the full archetype.json body by id.',
      inputSchema: {
        type: 'object',
        properties: {
          archetype_id: { type: 'string' },
          projectId: { type: 'string' },
        },
        required: ['archetype_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          const open = registry.get(projectId);
          if (open) catalog.refreshForProject(projectId, open.path);
        }
        const a = catalog.getArchetype(args.archetype_id as string, projectId);
        if (!a) return { ok: false, error: 'archetype-not-found', message: args.archetype_id as string };
        return { ok: true, archetype: a.body, source: a.source };
      },
    },
    {
      name: 'archetype.instantiate_into_project',
      description:
        'Scaffold an archetype into an already-open project. Forwards to the sidecar, which materializes the archetype chain into the project cells. Returns archetype-not-found (WP-09) if no definition exists yet.',
      inputSchema: {
        type: 'object',
        properties: {
          archetype_id: { type: 'string' },
          project_id: { type: 'string' },
        },
        required: ['archetype_id', 'project_id'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'archetype.instantiate_into_project', {
          projectId: args.project_id,
          archetypeId: args.archetype_id,
        }),
    },
    {
      name: 'archetype.save_custom',
      description: 'Write a custom archetype under the project archetypes/ dir.',
      inputSchema: {
        type: 'object',
        properties: {
          archetype: { type: 'object', additionalProperties: true },
          project_id: { type: 'string' },
        },
        required: ['archetype', 'project_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.project_id as string;
        const open = registry.get(projectId);
        if (!open) return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
        try {
          const entry = catalog.writeCustomArchetype(open.path, projectId, args.archetype as Record<string, unknown>);
          return { ok: true, archetype_id: entry.archetype_id, path: entry.path };
        } catch (e) {
          return { ok: false, error: 'internal-error', message: (e as Error).message };
        }
      },
    },
    {
      name: 'archetype.delete',
      description: 'Delete a custom archetype. Built-ins return { ok:false, error:"cannot-delete-builtin" }.',
      inputSchema: {
        type: 'object',
        properties: {
          archetype_id: { type: 'string' },
          project_id: { type: 'string' },
        },
        required: ['archetype_id', 'project_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.project_id as string;
        const open = registry.get(projectId);
        if (!open) return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
        const r = catalog.deleteCustomArchetype(open.path, projectId, args.archetype_id as string);
        if (r.ok) return { ok: true };
        if (r.reason === 'cannot-delete-builtin') return { ok: false, error: 'cannot-delete-builtin' };
        if (r.reason === 'not-found') return { ok: false, error: 'archetype-not-found' };
        return { ok: false, error: 'internal-error', message: r.reason };
      },
    },
  ];
}
