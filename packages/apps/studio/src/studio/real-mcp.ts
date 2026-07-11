// com.ikenga.studio · real MCP client (Wave 3)
//
// The live counterpart to __mocks__/mcp.ts. Routes every UI tool call through
// the shell's pkg-MCP bridge (bridge.callPkgTool → shell `oncalltool` →
// pkg_mcp_call → this pkg's `studio` MCP server, mcp/dist/index.js), then
// reshapes the server's response back to the UI/mock contract the views were
// written against.
//
// Three axes of drift between the real MCP server (WP-06) and the mock
// contract (WP-07) the views consume — this module is the thin adapter that
// bridges all three:
//
//   1. ENVELOPE. The studio MCP wraps every tool result as
//        { content: [{ type:'text', text: JSON.stringify(result) }], isError }
//      (mcp/src/index.ts). It sets NO structuredContent — so we parse
//      content[0].text and unwrap the { ok, ...payload } body.
//
//   2. ARG SHAPE. The server's sidecar RPCs are camelCase and carry an
//      explicit projectId/cellId on nearly every call (rpc-types.ts), while
//      the UI's typed helpers (mcp-client.ts) are snake_case and omit the
//      project on cell-scoped calls (storyboard.read_cell(cell_uid),
//      write_cell(cell_uid, patch)). We hold the active project + a cell cache
//      so those calls can be re-projected, and write_cell can do the
//      read-modify-write the server expects (it takes a FULL cell, not a patch).
//
//   3. RESULT SHAPE. project.open → { projectId } (UI wants project_id);
//      storyboard.read nests cells under result.project.cells (UI wants a
//      top-level cells[]); render.status → { record: <sqlite row> } with
//      snake_case columns (UI wants a RenderRecord); export.compose →
//      { exportId, outputPath } (UI wants { export_id, export_path }); and
//      archetype.list → { archetype_id, name, source } (UI wants the full
//      Archetype schema shape). Each is remapped below.
//
// EVENTS: the shell has no host→iframe relay for pkg:// events (ext-apps SDK
// limitation — Round-13 Finding). `subscribe()` here is a no-op that returns
// an unsubscribe fn; real-mode progress comes from POLLING in the views
// (render.status/render.list + storyboard.read refetch). Structured so a
// future event relay can drop straight into subscribe() without touching any
// call site.

import { callPkgTool } from './bridge';
import type { McpClient } from './mcp-client';
import type {
  Project, Cell, Beat, RenderRecord, Archetype, AspectRatio,
  StudioEventName, StudioEventPayloadMap,
} from './mcp-types';

// ─── active-project state (per client instance) ─────────────────────────

interface ActiveProject {
  projectId: string;
  path: string;
}

// ─── raw transport: call → parse text envelope → ok-check ────────────────

interface HostCallResultLike {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function raw(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = (await callPkgTool(name, args)) as HostCallResultLike;
  const text = res.content?.[0]?.text;
  let body: Record<string, unknown> = {};
  if (typeof text === 'string' && text.length > 0) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`[studio] ${name}: non-JSON MCP result: ${text.slice(0, 200)}`);
    }
  }
  if (res.isError || body.ok === false) {
    const err = (body.error as string) ?? 'mcp-error';
    const msg = (body.message as string) ?? (typeof text === 'string' ? text : '');
    throw new Error(`[studio] ${name} failed: ${err}${msg ? ` — ${msg}` : ''}`);
  }
  return body;
}

// ─── result-shape mappers ────────────────────────────────────────────────

/** SQLite render_queue row (snake_case) → UI RenderRecord (schema shape). */
function toRenderRecord(row: Record<string, unknown>): RenderRecord {
  const outputPath = (row.output_path ?? row.outputPath) as string | undefined;
  return {
    id: (row.record_id ?? row.recordId ?? row.id ?? '') as string,
    cell_uid: (row.cell_id ?? row.cellId ?? row.cell_uid ?? '') as string,
    engine: (row.engine ?? 'hf') as string,
    variant: (row.variant ?? 'default') as string,
    status: (row.status ?? 'queued') as RenderRecord['status'],
    output: outputPath ? { uri: outputPath } : { uri: '' },
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

/** Real archetype.list entry {archetype_id,name,source} OR a full archetype.json
 *  body → the UI Archetype schema shape. `description`/`chain` are filled from
 *  the body when present (archetype.get) and left empty for the list shape;
 *  the Launcher decorates presentation (beats/blurb/icon) off the id. */
function toArchetype(entry: Record<string, unknown>): Archetype {
  const id = (entry.archetype_id ?? entry.id ?? '') as string;
  const source = entry.source as string | undefined;
  const rawChain = Array.isArray(entry.chain) ? (entry.chain as Array<Record<string, unknown>>) : [];
  return {
    id,
    name: (entry.name ?? id) as string,
    description: (entry.description ?? '') as string,
    builtin: source ? source === 'builtin' : Boolean(entry.builtin ?? true),
    chain: rawChain.map((c) => ({
      block_id: (c.block_id ?? '') as string,
      bindings: (c.bindings as Record<string, unknown>) ?? {},
    })),
    metadata: (entry.metadata as Record<string, unknown>) ?? {},
  };
}

/** Derive a minimal beat rail from a project's cells (distinct beat_id in
 *  first-seen order). The real storyboard has no top-level beats[] the way the
 *  mock does; the views that need a rail can group cells themselves, but
 *  storyboard.read's typed helper promises `beats`, so we synthesize it. */
function deriveBeats(cells: Cell[]): Beat[] {
  const seen = new Map<string, Beat>();
  let order = 0;
  for (const c of cells) {
    const beatId = c.beat_id;
    if (!beatId || seen.has(beatId)) continue;
    seen.set(beatId, {
      id: beatId,
      label: c.label || beatId,
      order: order++,
      duration_ms: c.duration_ms || 0,
    });
  }
  return [...seen.values()];
}

// ─── factory ──────────────────────────────────────────────────────────────

export function createRealMcpClient(): McpClient {
  let active: ActiveProject | null = null;
  const cellCache = new Map<string, Cell>();

  const requireActive = (tool: string): ActiveProject => {
    if (!active) throw new Error(`[studio] ${tool}: no open project (call project.open/create first)`);
    return active;
  };

  const cacheCells = (cells: Cell[] | undefined): void => {
    if (!Array.isArray(cells)) return;
    for (const c of cells) if (c && typeof c.uid === 'string') cellCache.set(c.uid, c);
  };

  async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      // ─── project ──────────────────────────────────────────────────────
      case 'project.open': {
        const body = await raw('project.open', { path: args.path });
        const projectId = body.projectId as string;
        active = { projectId, path: args.path as string };
        cellCache.clear();
        cacheCells((body.project as Project | undefined)?.cells);
        return { project_id: projectId };
      }
      case 'project.create': {
        // Real project.create takes only {archetype_id, path, name}; aspect_ratio
        // is a UI-only field the sidecar does not accept (it derives resolution
        // from the archetype). Sent explicitly so no stray key reaches the RPC.
        const body = await raw('project.create', {
          archetype_id: args.archetype_id,
          path: args.path,
          name: args.name,
        });
        const projectId = body.projectId as string;
        active = { projectId, path: args.path as string };
        cellCache.clear();
        cacheCells((body.project as Project | undefined)?.cells);
        return { project_id: projectId };
      }
      case 'project.close': {
        await raw('project.close', { projectId: args.project_id });
        if (active?.projectId === args.project_id) { active = null; cellCache.clear(); }
        return { closed: true };
      }
      case 'project.list': {
        const body = await raw('project.list', {});
        return { projects: (body.projects as Project[]) ?? [] };
      }
      case 'project.info': {
        const body = await raw('project.info', { projectId: args.project_id });
        return body.project as Project;
      }

      // ─── storyboard ───────────────────────────────────────────────────
      case 'storyboard.read': {
        const projectId = (args.project_id as string) ?? requireActive('storyboard.read').projectId;
        const body = await raw('storyboard.read', { projectId });
        const project = body.project as Project | undefined;
        const cells = project?.cells ?? [];
        cacheCells(cells);
        return { project, beats: deriveBeats(cells), cells };
      }
      case 'storyboard.read_cell': {
        const a = requireActive('storyboard.read_cell');
        const body = await raw('storyboard.read_cell', { projectId: a.projectId, cellId: args.cell_uid });
        const cell = body.cell as Cell;
        if (cell) cellCache.set(cell.uid, cell);
        return cell;
      }
      case 'storyboard.write_cell': {
        const a = requireActive('storyboard.write_cell');
        const uid = args.cell_uid as string;
        let base = cellCache.get(uid);
        if (!base) {
          // Not cached yet — read it so we can send the FULL cell the sidecar
          // expects (it overwrites, not patches).
          const readBody = await raw('storyboard.read_cell', { projectId: a.projectId, cellId: uid });
          base = readBody.cell as Cell;
        }
        if (!base) throw new Error(`[studio] storyboard.write_cell: cell ${uid} not found`);
        const merged = { ...base, ...(args.patch as Partial<Cell>) } as Cell;
        const body = await raw('storyboard.write_cell', { projectId: a.projectId, cell: merged });
        const cell = (body.cell as Cell) ?? merged;
        cellCache.set(cell.uid, cell);
        return cell;
      }
      case 'storyboard.list_cells': {
        const a = requireActive('storyboard.list_cells');
        const body = await raw('storyboard.list_cells', {
          projectId: a.projectId,
          beat_id: args.beat_id,
          rung: args.rung,
        });
        const cells = (body.cells as Cell[]) ?? [];
        cacheCells(cells);
        return { cells };
      }
      case 'storyboard.set_approved': {
        const a = requireActive('storyboard.set_approved');
        await raw('storyboard.set_approved', {
          projectId: a.projectId,
          cellId: args.cell_uid,
          approved: args.approved,
        });
        return { ok: true };
      }

      // ─── composition / render ─────────────────────────────────────────
      case 'composition.render': {
        // Real composition.render REQUIRES cellId — the UI's whole-composition
        // render (no cell_uid) is expressed per-cell by the caller; here a
        // missing cell_uid is a programming error surfaced as a throw.
        const projectId = (args.project_id as string) ?? requireActive('composition.render').projectId;
        if (!args.cell_uid) throw new Error('[studio] composition.render: cell_uid is required in real mode');
        const body = await raw('composition.render', {
          projectId,
          cellId: args.cell_uid,
          engine: args.engine,
          aspect_ratio: args.aspect_ratio,
        });
        return { record_id: (body.recordId ?? body.record_id) as string };
      }
      case 'composition.preview': {
        const a = requireActive('composition.preview');
        const cellId = (args.cell_uid as string) ?? [...cellCache.keys()][0];
        const body = await raw('composition.preview', { projectId: a.projectId, cellId, engine: args.engine });
        return { preview_uri: (body.previewUri ?? body.preview_uri ?? '') as string };
      }
      case 'composition.validate': {
        const a = requireActive('composition.validate');
        const cellId = (args.cell_uid as string) ?? [...cellCache.keys()][0];
        const body = await raw('composition.validate', { projectId: a.projectId, cellId, engine: args.engine });
        return { valid: body.valid !== false, diagnostics: (body.diagnostics as unknown[]) ?? [] };
      }
      case 'render.list_engines': {
        const body = await raw('render.list_engines', {});
        return { engines: (body.engines as unknown[]) ?? [] };
      }
      case 'render.status': {
        const body = await raw('render.status', { recordId: args.record_id });
        const record = (body.record as Record<string, unknown>) ?? body;
        return toRenderRecord(record);
      }
      case 'render.cancel': {
        await raw('render.cancel', { recordId: args.record_id });
        return { cancelled: true };
      }
      case 'render.list': {
        const a = active;
        const body = await raw('render.list', {
          projectId: a?.projectId,
          status: args.status,
        });
        let records = ((body.records as Array<Record<string, unknown>>) ?? []).map(toRenderRecord);
        if (args.cell_uid) records = records.filter((r) => r.cell_uid === args.cell_uid);
        return { records };
      }

      // ─── export ───────────────────────────────────────────────────────
      case 'export.compose': {
        const projectId = (args.project_id as string) ?? requireActive('export.compose').projectId;
        const body = await raw('export.compose', {
          projectId,
          rung: args.rung,
          music_preset: args.music_preset,
          outputPath: args.output_path,
        });
        return {
          export_id: (body.exportId ?? body.export_id) as string,
          export_path: (body.outputPath ?? body.export_path ?? '') as string,
        };
      }
      case 'export.status': {
        const body = await raw('export.status', { exportId: args.export_id });
        const rec = (body.record as Record<string, unknown>) ?? body;
        return {
          export_id: (rec.exportId ?? rec.export_id) as string,
          project_id: (rec.projectId ?? rec.project_id ?? '') as string,
          status: (rec.status ?? 'queued') as 'queued' | 'running' | 'done' | 'failed',
          output_uri: (rec.outputPath ?? rec.output_uri) as string | undefined,
        };
      }
      case 'export.list': {
        const body = await raw('export.list', { projectId: active?.projectId });
        return { exports: (body.exports as unknown[]) ?? [] };
      }

      // ─── archetype ────────────────────────────────────────────────────
      case 'archetype.list': {
        const body = await raw('archetype.list', {});
        const list = (body.archetypes as Array<Record<string, unknown>>) ?? [];
        return { archetypes: list.map(toArchetype) };
      }
      case 'archetype.get': {
        const body = await raw('archetype.get', { archetype_id: args.id });
        const arch = (body.archetype as Record<string, unknown>) ?? {};
        if (body.source && arch.source === undefined) arch.source = body.source;
        return toArchetype(arch);
      }
      case 'archetype.instantiate_into_project': {
        const a = requireActive('archetype.instantiate_into_project');
        const body = await raw('archetype.instantiate_into_project', {
          archetype_id: args.archetype_id,
          project_id: a.projectId,
        });
        const cells = (body.cells as Cell[]) ?? [];
        cacheCells(cells);
        return { beats: (body.beats as Beat[]) ?? deriveBeats(cells), cells };
      }
      case 'archetype.save_custom': {
        const a = requireActive('archetype.save_custom');
        const body = await raw('archetype.save_custom', {
          archetype: { name: args.name, chain: args.chain, description: args.description },
          project_id: a.projectId,
        });
        return { archetype_id: (body.archetype_id ?? body.archetypeId) as string };
      }

      // ─── block ────────────────────────────────────────────────────────
      case 'block.list': {
        const body = await raw('block.list', { kind: args.kind, tags: args.tags });
        return { blocks: (body.blocks as unknown[]) ?? [] };
      }
      case 'block.get': {
        const body = await raw('block.get', { block_id: args.id });
        return (body.block as unknown) ?? body;
      }
      case 'block.instantiate': {
        const body = await raw('block.instantiate', {
          block_id: args.block_id,
          bindings: args.bindings ?? {},
          projectId: active?.projectId,
        });
        return body.cell !== undefined ? { beat: null, cells: [body.cell] } : body;
      }

      // ─── fall-through: pass args verbatim, strip the ok wrapper ────────
      default: {
        const body = await raw(name, args);
        const { ok: _ok, ...rest } = body;
        void _ok;
        return rest;
      }
    }
  }

  return {
    mode: 'real',
    async callTool<TResult = unknown>(name: string, args: Record<string, unknown> = {}) {
      return (await dispatch(name, args)) as TResult;
    },
    subscribe<E extends StudioEventName>(
      _event: E,
      _handler: (payload: StudioEventPayloadMap[E]) => void,
    ): () => void {
      // No host→iframe pkg-event relay exists yet (Round-13 Finding). Real-mode
      // progress is driven by POLLING in the views. This is intentionally a
      // no-op so a future event relay can be wired here without changing any
      // subscribe() call site.
      return () => {};
    },
  };
}
