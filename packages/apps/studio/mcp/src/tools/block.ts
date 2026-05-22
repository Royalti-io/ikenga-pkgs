/**
 * `block.*` tools — catalog-backed (no open project required for list/get).
 *
 * Built-in blocks load from `<pkgRoot>/skills/* /blocks/** /block.json` at
 * MCP startup. Project-scoped custom blocks load lazily on `project.open`
 * (see Catalog.refreshForProject); for P1 we rescan on every `block.list`
 * call when a projectId is supplied to keep semantics simple.
 *
 * `block.instantiate` does NOT write to disk — it returns the
 * materialized cell JSON; callers pipe that into `storyboard.write_cell`.
 */

import type { Catalog } from '../catalog.js';
import type { OpenProjectRegistry, ToolDef } from './types.js';

export function blockTools(catalog: Catalog, registry: OpenProjectRegistry): ToolDef[] {
  return [
    {
      name: 'block.list',
      description: 'List blocks in the catalog. Filters: kind, tags (OR-match). Project-scoped custom blocks merge in when projectId is supplied.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          kind: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          const open = registry.get(projectId);
          if (open) catalog.refreshForProject(projectId, open.path);
        }
        const blocks = catalog.listBlocks({
          projectId,
          kind: args.kind as string | undefined,
          tags: args.tags as string[] | undefined,
        });
        return {
          ok: true,
          blocks: blocks.map((b) => ({
            block_id: b.block_id,
            kind: b.kind,
            name: b.name,
            tags: b.tags ?? [],
            source: b.source,
          })),
        };
      },
    },
    {
      name: 'block.get',
      description: 'Fetch the full block.json body by id.',
      inputSchema: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          projectId: { type: 'string' },
        },
        required: ['block_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          const open = registry.get(projectId);
          if (open) catalog.refreshForProject(projectId, open.path);
        }
        const b = catalog.getBlock(args.block_id as string, projectId);
        if (!b) return { ok: false, error: 'block-not-found', message: args.block_id as string };
        return { ok: true, block: b.body, source: b.source };
      },
    },
    {
      name: 'block.instantiate',
      description: 'Instantiate a block into a concrete cell JSON given bindings. Does NOT write to disk — pipe the result into storyboard.write_cell.',
      inputSchema: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          bindings: { type: 'object', additionalProperties: true },
          projectId: { type: 'string' },
        },
        required: ['block_id', 'bindings'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.projectId as string | undefined;
        const b = catalog.getBlock(args.block_id as string, projectId);
        if (!b) return { ok: false, error: 'block-not-found', message: args.block_id as string };
        // P1 instantiation: shallow merge of `bindings` into block.template (or block body if no template field).
        const template = (b.body.template ?? {}) as Record<string, unknown>;
        const merged = { ...template, ...((args.bindings as Record<string, unknown>) ?? {}), block_id: b.block_id };
        return { ok: true, cell: merged };
      },
    },
    {
      name: 'block.create_custom',
      description: 'Write a custom block under the project blocks/custom/ dir. Requires an open project.',
      inputSchema: {
        type: 'object',
        properties: {
          block: { type: 'object', additionalProperties: true },
          project_id: { type: 'string' },
        },
        required: ['block', 'project_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.project_id as string;
        const open = registry.get(projectId);
        if (!open) return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
        try {
          const entry = catalog.writeCustomBlock(open.path, projectId, args.block as Record<string, unknown>);
          return { ok: true, block_id: entry.block_id, path: entry.path };
        } catch (e) {
          return { ok: false, error: 'internal-error', message: (e as Error).message };
        }
      },
    },
    {
      name: 'block.delete',
      description: 'Delete a custom block. Built-in blocks return { ok:false, error:"cannot-delete-builtin" }.',
      inputSchema: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          project_id: { type: 'string' },
        },
        required: ['block_id', 'project_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectId = args.project_id as string;
        const open = registry.get(projectId);
        if (!open) return { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` };
        const r = catalog.deleteCustomBlock(open.path, projectId, args.block_id as string);
        if (r.ok) return { ok: true };
        if (r.reason === 'cannot-delete-builtin') return { ok: false, error: 'cannot-delete-builtin' };
        if (r.reason === 'not-found') return { ok: false, error: 'block-not-found' };
        return { ok: false, error: 'internal-error', message: r.reason };
      },
    },
  ];
}
