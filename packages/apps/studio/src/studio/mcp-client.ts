// com.ikenga.studio · MCP client (thin wrapper)
//
// Two implementations behind one interface:
//
//   - real:  routes every call through bridge.app.callServerTool({ name, args })
//            and exposes events via the host's `pkg://com.ikenga.studio/<event>`
//            notification channel. Lights up in Wave 3 once WP-06 ships the
//            real MCP server.
//
//   - mock:  ./__mocks__/mcp.ts — canned responses + a setTimeout-driven event
//            emitter that mirrors what WP-06 will publish, so commits 5–15 can
//            light up the cross-linking, scrub-sync, and now-rendering beacon
//            against synthetic data.
//
// Selection rule for P1:
//   - Standalone-dev (no parent window)  → mock
//   - In-shell, but no real MCP server present (P1 default) → mock
//   - In-shell, real MCP server present (Wave 3 onward)     → real
//
// The third condition is detected by probing for the real server with a
// cheap `render.list_engines` call wrapped in a timeout. Until WP-06 lands
// the probe always times out and we fall back to mock — which is the
// correct behaviour today.

import { isStandalone } from './bridge';
import type {
  StudioEventName,
  StudioEventPayloadMap,
} from './mcp-types';

// ─── Public interface ───────────────────────────────────────────────────

export interface McpClient {
  /** Invoke an MCP tool by namespaced name (e.g. 'storyboard.read'). The
   *  result type is whatever the caller asserts — the canonical typed
   *  helpers below (callStoryboard*, callComposition*, …) wrap callTool
   *  with the correct narrowing. */
  callTool<TResult = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<TResult>;

  /** Subscribe to a pkg event channel
   *  (pkg://com.ikenga.studio/<event>). Returns an unsubscribe fn. */
  subscribe<E extends StudioEventName>(
    event: E,
    handler: (payload: StudioEventPayloadMap[E]) => void,
  ): () => void;

  /** Mode tag for diagnostics + UI badges. */
  readonly mode: 'mock' | 'real';
}

// ─── Selection / factory ────────────────────────────────────────────────

let _client: McpClient | null = null;

/** When true, getMcpClient() returns the real WP-06-backed client. Flipped
 *  in Wave 3 once the real MCP server ships; until then the mock is the only
 *  implementation, so this stays false and the selection below is a no-op.
 *  `isStandalone()` would force the mock regardless. */
const USE_REAL_MCP = false;

/** Lazily resolves and caches the MCP client. Idempotent — calling twice
 *  returns the same promise. */
export async function getMcpClient(): Promise<McpClient> {
  if (_client) return _client;

  if (!USE_REAL_MCP || isStandalone()) {
    const { createMockMcpClient } = await import('./__mocks__/mcp.js');
    _client = createMockMcpClient();
    return _client;
  }

  // Wave 3 (post-WP-06): probe for the real server and route callTool through
  // bridge.app.callServerTool. Not wired in P1.
  throw new Error('[studio] real MCP client not wired (WP-06 / Wave 3)');
}

/** TEST/DEV ONLY. Drops the cached client so the next getMcpClient() call
 *  re-resolves. Used by view tests that need to inject a custom mock. */
export function __resetMcpClient(): void {
  _client = null;
}

// ─── Typed helpers ──────────────────────────────────────────────────────
//
// Thin sugar over callTool so views read like `await sb.read({...})` rather
// than `await client.callTool('storyboard.read', {...})`. The view layer
// imports these directly — it never sees the string method name.

import type {
  Project, Cell, Beat, RenderRecord, EngineCapability, Block,
  Archetype, ExportRecord, AspectRatio, Rung,
} from './mcp-types';

export const projectApi = {
  open:   (c: McpClient, path: string) =>
    c.callTool<{ project_id: string }>('project.open', { path }),
  close:  (c: McpClient, project_id: string) =>
    c.callTool<{ closed: boolean }>('project.close', { project_id }),
  list:   (c: McpClient) =>
    c.callTool<{ projects: Project[] }>('project.list'),
  create: (c: McpClient, args: { archetype_id: string; path: string; name: string; aspect_ratio?: AspectRatio }) =>
    c.callTool<{ project_id: string }>('project.create', args),
  info:   (c: McpClient, project_id: string) =>
    c.callTool<Project>('project.info', { project_id }),
};

export const storyboardApi = {
  read:        (c: McpClient, project_id: string) =>
    c.callTool<{ project: Project; beats: Beat[]; cells: Cell[] }>('storyboard.read', { project_id }),
  read_cell:   (c: McpClient, cell_uid: string) =>
    c.callTool<Cell>('storyboard.read_cell', { cell_uid }),
  write_cell:  (c: McpClient, cell_uid: string, patch: Partial<Cell>) =>
    c.callTool<Cell>('storyboard.write_cell', { cell_uid, patch }),
  list_cells:  (c: McpClient, args?: { beat_id?: string; rung?: Rung }) =>
    c.callTool<{ cells: Cell[] }>('storyboard.list_cells', args ?? {}),
  set_approved:(c: McpClient, cell_uid: string, approved: boolean) =>
    c.callTool<{ ok: true }>('storyboard.set_approved', { cell_uid, approved }),
};

export const compositionApi = {
  render: (c: McpClient, args: { project_id: string; engine?: string; aspect_ratio?: AspectRatio; rung?: Rung }) =>
    c.callTool<{ record_id: string }>('composition.render', args),
  preview: (c: McpClient, args: { project_id: string; engine?: string }) =>
    c.callTool<{ preview_uri: string }>('composition.preview', args),
  validate: (c: McpClient, args: { project_id: string; engine?: string }) =>
    c.callTool<{ valid: boolean; diagnostics: Array<{ severity: 'error' | 'warn'; message: string }> }>('composition.validate', args),
};

export const renderApi = {
  list_engines: (c: McpClient) =>
    c.callTool<{ engines: EngineCapability[] }>('render.list_engines'),
  status:       (c: McpClient, record_id: string) =>
    c.callTool<RenderRecord>('render.status', { record_id }),
  cancel:       (c: McpClient, record_id: string) =>
    c.callTool<{ cancelled: boolean }>('render.cancel', { record_id }),
  list:         (c: McpClient, args?: { cell_uid?: string; status?: string }) =>
    c.callTool<{ records: RenderRecord[] }>('render.list', args ?? {}),
};

export const blockApi = {
  list: (c: McpClient, args?: { kind?: Block['kind']; tags?: string[] }) =>
    c.callTool<{ blocks: Block[] }>('block.list', args ?? {}),
  get:  (c: McpClient, id: string) =>
    c.callTool<Block>('block.get', { id }),
  instantiate: (c: McpClient, args: { block_id: string; bindings: Record<string, unknown> }) =>
    c.callTool<{ beat: Beat; cells: Cell[] }>('block.instantiate', args),
};

export const archetypeApi = {
  list: (c: McpClient) =>
    c.callTool<{ archetypes: Archetype[] }>('archetype.list'),
  get:  (c: McpClient, id: string) =>
    c.callTool<Archetype>('archetype.get', { id }),
  instantiate_into_project: (c: McpClient, args: { archetype_id: string; bindings: Record<string, unknown> }) =>
    c.callTool<{ beats: Beat[]; cells: Cell[] }>('archetype.instantiate_into_project', args),
  save_custom: (c: McpClient, args: { name: string; chain: string[]; description: string }) =>
    c.callTool<{ archetype_id: string }>('archetype.save_custom', args),
};

export const exportApi = {
  compose: (c: McpClient, args: { project_id: string; rung?: Rung; music_preset?: string; output_path?: string }) =>
    c.callTool<{ export_id: string; export_path: string }>('export.compose', args),
  status:  (c: McpClient, export_id: string) =>
    c.callTool<ExportRecord>('export.status', { export_id }),
  list:    (c: McpClient) =>
    c.callTool<{ exports: ExportRecord[] }>('export.list'),
};
