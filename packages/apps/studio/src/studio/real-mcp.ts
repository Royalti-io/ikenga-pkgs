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
  Project, Cell, Beat, RenderRecord, Archetype, AspectRatio, Anchor,
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

/** epoch-ms number (or numeric string) → ISO-8601, else undefined. The sidecar
 *  stores render/export timestamps as `Date.now()` integers; the schema wants
 *  ISO strings, and the records table formats them relative-to-now. */
function toIso(v: unknown): string | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : undefined;
}

/** SQLite render_queue row (snake_case) → UI RenderRecord (schema shape).
 *  Carries the started_at/finished_at timestamps (the C-C records table needs
 *  "finished" per cell) which the older mapper dropped. Also parses the
 *  metadata column (JSON string from a DB row, or an object from an inline
 *  RenderRecord like ingest_external) and surfaces model_id / cost_actual /
 *  cost_estimate / seed onto the top-level RenderRecord fields the Ledger
 *  reads (H1). */
function toRenderRecord(row: Record<string, unknown>): RenderRecord {
  const outputPath = (row.output_path ?? row.outputPath ??
    (row.output as { uri?: string } | undefined)?.uri) as string | undefined;
  const startedAt = toIso(row.started_at ?? row.startedAt);
  const finishedAt = toIso(row.finished_at ?? row.finishedAt);
  // H1 — parse metadata. From a DB row it's a JSON string; from an inline
  // RenderRecord (ingest_external) it's already an object.
  const rawMeta = row.metadata;
  let metadata: Record<string, unknown> = {};
  if (typeof rawMeta === 'string' && rawMeta.length > 0) {
    try { metadata = JSON.parse(rawMeta) as Record<string, unknown>; } catch { metadata = {}; }
  } else if (rawMeta && typeof rawMeta === 'object') {
    metadata = rawMeta as Record<string, unknown>;
  }
  return {
    id: (row.record_id ?? row.recordId ?? row.id ?? '') as string,
    cell_uid: (row.cell_id ?? row.cellId ?? row.cell_uid ?? '') as string,
    engine: (row.engine ?? 'hf') as string,
    model_id: (row.model_id ?? metadata.model_id) as string | undefined,
    variant: (row.variant ?? metadata.variant ?? 'default') as string,
    status: (row.status ?? 'queued') as RenderRecord['status'],
    ...(outputPath ? { output: { uri: outputPath } } : {}),
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    cost_actual: typeof row.cost_actual === 'number'
      ? row.cost_actual
      : metadata.cost_actual as number | undefined,
    cost_estimate: typeof row.cost_estimate === 'number'
      ? row.cost_estimate
      : metadata.cost_estimate as number | undefined,
    error: (row.error as string | undefined) ?? undefined,
    metadata,
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

/** UI Rung ('0_beat_sheet'|'1_lofi'|'2_hifi') or a raw number → the numeric
 *  rung (0|1|2) the sidecar's export.compose expects. undefined passes through
 *  as "no rung filter". */
function rungToNumber(rung: unknown): number | undefined {
  if (typeof rung === 'number') return rung;
  if (rung === '0_beat_sheet') return 0;
  if (rung === '1_lofi') return 1;
  if (rung === '2_hifi') return 2;
  return undefined;
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
        // The sidecar returns `ProjectSummary[]` (camelCase: projectId / name /
        // path / lastOpened), NOT the full Project schema — it has no archetype
        // / aspect / cell-count for a project that isn't open. Normalize to the
        // snake shape the Launcher consumes and pass through ONLY what's real.
        const body = await raw('project.list', {});
        const rows = (body.projects as Array<Record<string, unknown>>) ?? [];
        return {
          projects: rows.map((r) => ({
            project_id: (r.projectId ?? r.project_id ?? r.slug ?? '') as string,
            name: (r.name ?? r.title ?? '') as string,
            path: (r.path ?? '') as string,
            lastOpened: (r.lastOpened ?? r.last_opened) as number | undefined,
            // exists: cheap fs check the sidecar performs at list-time. Absent
            // on older sidecars → leave undefined so the Launcher treats the
            // row as present rather than dimming it.
            exists: (r.exists as boolean | undefined),
          })),
        };
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
      // Fountain read seam (Wave 5) — the Script view's Fountain mode reads the
      // REAL <root>/script.fountain. projectId injected from the active project.
      case 'storyboard.read_fountain': {
        const a = requireActive('storyboard.read_fountain');
        const body = await raw('storyboard.read_fountain', { projectId: a.projectId });
        return {
          exists: Boolean(body.exists),
          text: (body.text as string) ?? '',
        };
      }
      // Fountain write seam — persist the REAL <root>/script.fountain (UTF-8).
      // The durable save for a future edit / Chi authoring flow. projectId injected.
      case 'storyboard.write_fountain': {
        const a = requireActive('storyboard.write_fountain');
        const body = await raw('storyboard.write_fountain', {
          projectId: a.projectId,
          text: args.text,
        });
        return {
          exists: Boolean(body.exists),
          bytes: (body.bytes as number) ?? 0,
        };
      }
      // Cell-content seams (Wave 3) — the editor reads/writes the REAL authored
      // source file at the cell's content_path (the Cell record only points to
      // it). projectId is injected from the active project.
      case 'storyboard.read_cell_content': {
        const a = requireActive('storyboard.read_cell_content');
        const body = await raw('storyboard.read_cell_content', {
          projectId: a.projectId,
          cellId: args.cell_uid,
        });
        return {
          html: (body.html as string) ?? '',
          content_path: (body.content_path as string) ?? '',
          exists: Boolean(body.exists),
        };
      }
      case 'storyboard.write_cell_content': {
        const a = requireActive('storyboard.write_cell_content');
        const body = await raw('storyboard.write_cell_content', {
          projectId: a.projectId,
          cellId: args.cell_uid,
          html: args.html,
        });
        return {
          content_path: (body.content_path as string) ?? '',
          bytes: (body.bytes as number) ?? 0,
        };
      }
      // anchor.list needs the active projectId injected (the default
      // fall-through passes args verbatim, which the sidecar would reject).
      case 'anchor.list': {
        const a = requireActive('anchor.list');
        const body = await raw('anchor.list', { projectId: a.projectId });
        return { anchors: (body.anchors as unknown[]) ?? [] };
      }
      // anchor.generate (WF-1) — fal still → project anchor. projectId injected;
      // kind/name/prompt/seed/model already share the sidecar's names. Sidecar
      // returns { ok, anchor } (via create()); the UI wants the created Anchor.
      case 'anchor.generate': {
        const projectId = (args.project_id as string) ?? requireActive('anchor.generate').projectId;
        const body = await raw('anchor.generate', {
          projectId,
          kind: args.kind,
          name: args.name,
          prompt: args.prompt,
          seed: args.seed,
          model: args.model,
        });
        return body.anchor as Anchor;
      }
      case 'anchor.create': {
        const a = requireActive('anchor.create');
        const body = await raw('anchor.create', { projectId: a.projectId, anchor: args.anchor });
        return body.anchor as Anchor;
      }
      case 'anchor.delete': {
        const a = requireActive('anchor.delete');
        const body = await raw('anchor.delete', { projectId: a.projectId, anchorId: args.anchor_id });
        return { anchorId: (body.anchorId as string) ?? (args.anchor_id as string) };
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
      // Cell add/delete (Canvas "New cell" + per-tile delete). The UI passes a
      // full Cell (create) or a uid (delete); projectId is injected from the
      // active project. delete_cell removes the storyboard.json record only —
      // the on-disk cell dir is left in place (sidecar deleteCell).
      case 'storyboard.create_cell': {
        const a = requireActive('storyboard.create_cell');
        const body = await raw('storyboard.create_cell', { projectId: a.projectId, cell: args.cell });
        const cell = body.cell as Cell | undefined;
        if (cell) cellCache.set(cell.uid, cell);
        return { cell };
      }
      case 'storyboard.delete_cell': {
        const a = requireActive('storyboard.delete_cell');
        const uid = args.cell_uid as string;
        const body = await raw('storyboard.delete_cell', { projectId: a.projectId, cellId: uid });
        cellCache.delete(uid);
        return { cellId: (body.cellId as string) ?? uid };
      }

      // ─── composition / render ─────────────────────────────────────────
      case 'composition.render': {
        // Real composition.render REQUIRES cellId — the UI's whole-composition
        // render (no cell_uid) is expressed per-cell by the caller; here a
        // missing cell_uid is a programming error surfaced as a throw.
        // `variant` is forwarded so the fal adapter's resolveVideoModel picks
        // up the user's model selection (H2 — Canvas engine picker).
        const projectId = (args.project_id as string) ?? requireActive('composition.render').projectId;
        if (!args.cell_uid) throw new Error('[studio] composition.render: cell_uid is required in real mode');
        const body = await raw('composition.render', {
          projectId,
          cellId: args.cell_uid,
          engine: args.engine,
          aspect_ratio: args.aspect_ratio,
          variant: args.variant,
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
        // The real registry row nests the G2 matrix under `.capabilities`
        // ({ id, capabilities: { still, video, aspect_ratios, … } }) while the
        // mock/UI EngineCapability contract is flat. Spread the caps up so the
        // views read `engine.still` / `engine.aspect_ratios` identically in both
        // modes (defensive: an already-flat row passes through unchanged).
        const rows = (body.engines as Array<Record<string, unknown>>) ?? [];
        const engines = rows.map((e) => {
          const { capabilities, ...rest } = e as { capabilities?: Record<string, unknown> };
          return { ...(capabilities ?? {}), ...rest };
        });
        return { engines };
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
      case 'render.read_bytes': {
        const body = await raw('render.read_bytes', { recordId: args.record_id });
        return {
          base64: (body.base64 as string) ?? '',
          mime: (body.mime as string) ?? 'video/mp4',
          sizeBytes: (body.sizeBytes as number) ?? 0,
          path: (body.path as string) ?? '',
        };
      }
      case 'render.read_poster': {
        const body = await raw('render.read_poster', { recordId: args.record_id });
        return {
          base64: (body.base64 as string) ?? '',
          mime: (body.mime as string) ?? 'image/png',
          sizeBytes: (body.sizeBytes as number) ?? 0,
          path: (body.path as string) ?? '',
        };
      }
      // render.ingest_external (WF-1) — attach an externally-produced clip to a
      // cell as a done render row (return leg of export.prompt_package).
      // projectId injected; snake args renamed to the sidecar's shape. Sidecar
      // returns { ok, recordId, engine, outputPath, record }; reuse
      // toRenderRecord() to reshape `record` into the UI RenderRecord.
      case 'render.ingest_external': {
        const projectId = (args.project_id as string) ?? requireActive('render.ingest_external').projectId;
        const body = await raw('render.ingest_external', {
          projectId,
          cellId: args.cell_id,
          filePath: args.file_path,
          engine: args.engine,
          model_id: args.model_id,
          cost_actual: args.cost_actual,
        });
        const record = (body.record as Record<string, unknown>) ?? body;
        return toRenderRecord(record);
      }

      // ─── export ───────────────────────────────────────────────────────
      case 'export.compose': {
        const projectId = (args.project_id as string) ?? requireActive('export.compose').projectId;
        // The UI passes rung as a Rung string ('2_hifi'); the real tool wants a
        // number (0|1|2). Convert, and omit when absent so the sidecar composes
        // all cells in beat order.
        const rungNum = rungToNumber(args.rung);
        const body = await raw('export.compose', {
          projectId,
          ...(rungNum !== undefined ? { rung: rungNum } : {}),
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
      case 'export.read_bytes': {
        const body = await raw('export.read_bytes', { exportId: args.export_id });
        return {
          base64: (body.base64 as string) ?? '',
          mime: (body.mime as string) ?? 'video/mp4',
          sizeBytes: (body.sizeBytes as number) ?? 0,
          path: (body.path as string) ?? '',
        };
      }
      case 'export.check_bed': {
        const projectId = (args.project_id as string) ?? requireActive('export.check_bed').projectId;
        const body = await raw('export.check_bed', { projectId, music_preset: args.music_preset });
        return {
          has_bed: Boolean(body.hasBed ?? body.has_bed),
          will_be_silent: body.willBeSilent === undefined ? !(body.hasBed ?? body.has_bed) : Boolean(body.willBeSilent),
          by_design: Boolean(body.byDesign ?? body.by_design),
          path: (body.path as string | undefined) ?? undefined,
        };
      }
      // export.prompt_package (WF-1) — platform-shaped prompt bundle for an
      // API-less generator. projectId injected; cell_id → cellId. The sidecar's
      // `packages[]` elements (cellId/prompt/ref_image_uri/ref_note/
      // aspect_ratio/duration_ms/camera) pass through verbatim — the UI
      // PromptPackage type matches that wire shape.
      case 'export.prompt_package': {
        const projectId = (args.project_id as string) ?? requireActive('export.prompt_package').projectId;
        const body = await raw('export.prompt_package', {
          projectId,
          cellId: args.cell_id,
          platform: args.platform,
        });
        return {
          platform: body.platform as string,
          path: (body.path as string) ?? '',
          count: (body.count as number) ?? 0,
          packages: (body.packages as unknown[]) ?? [],
        };
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
        // The catalog writer (catalog.writeCustomArchetype) keys the on-disk
        // archetype dir off `archetype_id`/`id`; omitting it makes the write
        // throw `archetype.archetype_id is required`. Thread the caller's id
        // (under both keys so either lookup resolves) and persist the full
        // ArchetypeChainEntry shape ({block_id,bindings}) so archetype.get
        // round-trips and archetype.instantiate_into_project can consume it.
        const body = await raw('archetype.save_custom', {
          archetype: {
            archetype_id: args.archetype_id,
            id: args.archetype_id,
            name: args.name,
            chain: args.chain,
            description: args.description,
          },
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
