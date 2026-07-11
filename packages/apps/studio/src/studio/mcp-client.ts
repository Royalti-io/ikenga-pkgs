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
// Selection rule:
//   - Standalone-dev (no parent window)               → mock
//   - In-shell, real MCP server answers the probe      → real
//   - In-shell, server absent / crash-looping / slow   → mock (demo data)
//
// The real-vs-mock choice in-shell is decided by a cheap `render.list_engines`
// probe wrapped in a timeout (getMcpClient below): a pass selects the real
// client, a throw/timeout falls back to the mock so a missing or crash-looping
// studio MCP server degrades to demo data instead of throwing on every call.

import { connectBridge, isStandalone } from './bridge';
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

/** Lazily resolves and caches the MCP client. Idempotent — calling twice
 *  returns the same promise.
 *
 *  Selection is RUNTIME, not a build flag:
 *    • Standalone dev (plain browser tab, no shell parent) → mock. Lets
 *      `pnpm dev` boot the iframe without a backend.
 *    • In-shell (mounted in an Ikenga pane) → REAL, but only once a cheap
 *      `render.list_engines` probe confirms the pkg's `studio` MCP server
 *      actually answers. If the server is absent / crash-looping / slow past
 *      the timeout, we fall back to the mock client so the UI degrades to
 *      demo data (mode==='mock') instead of throwing a raw '[studio] … failed'
 *      on every view call.
 *
 *  `isStandalone()` is the synchronous discriminator. main.tsx only renders
 *  <App/> after connectBridge() resolves, so in shell mode the bridge is
 *  already connected before any view calls this; we await it again here
 *  (idempotent) so the real client's transport is guaranteed live. */
const PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('mcp-probe-timeout')), ms)),
  ]);
}

/** A failed probe must not strand the session in demo data forever (a slowly
 *  booting MCP server would otherwise stay mocked until a pane reload) — the
 *  mock result is cached soft: subsequent calls re-probe, at most once per
 *  backoff window, and swap to the real client when it comes up. */
const PROBE_RETRY_MS = 10_000;
let _probeFailedAt = 0;

export async function getMcpClient(): Promise<McpClient> {
  if (_client && !(_probeFailedAt && Date.now() - _probeFailedAt >= PROBE_RETRY_MS)) {
    return _client;
  }

  if (isStandalone()) {
    _probeFailedAt = 0;
    const { createMockMcpClient } = await import('./__mocks__/mcp.js');
    _client = createMockMcpClient();
    return _client;
  }

  await connectBridge();
  const { createRealMcpClient } = await import('./real-mcp.js');
  const real = createRealMcpClient();
  // Guarded probe: render.list_engines needs no open project and is cheap.
  // A pass proves the real studio MCP server is live; a throw/timeout means it
  // is absent or crash-looping — fall back to the mock so the UI stays usable.
  try {
    await withTimeout(real.callTool('render.list_engines'), PROBE_TIMEOUT_MS);
    _client = real;
    _probeFailedAt = 0;
  } catch {
    if (!_client) {
      const { createMockMcpClient } = await import('./__mocks__/mcp.js');
      _client = createMockMcpClient();
    }
    _probeFailedAt = Date.now();
  }
  return _client;
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
// Separate line (own domain) so the shared type import above stays untouched.
import type { Anchor } from './mcp-types';

/** What `project.list` ACTUALLY returns, tolerant of the two real runtime
 *  shapes it resolves to (the "honesty rule" — this boundary genuinely drifts):
 *
 *   • real (in-shell): the sidecar's `ProjectSummary` — `projectId` / `name` /
 *     `path` / `lastOpened` (epoch ms), camelCase, ONE row per previously-opened
 *     project, most-recent first. It carries NO archetype / aspect / cell-count /
 *     render-coverage — those are NOT cheaply reachable for a project that isn't
 *     open (render.list is projectId-scoped to the open project).
 *   • mock (standalone): a full `Project` schema object (snake_case `slug` /
 *     `title` / `archetype_id` / `aspect_ratio` / `cells[]` / `updated_at`).
 *
 *  All fields are optional so the Launcher's `normalizeRecent()` can read
 *  whichever the active client emitted and degrade honestly (drop the coverage
 *  meter + exported/draft pill for real rows that don't carry them). */
export interface RawRecentProject {
  // real ProjectSummary (camelCase)
  projectId?: string;
  lastOpened?: number;
  // full Project / mock (snake_case + schema)
  project_id?: string;
  slug?: string;
  title?: string;
  updated_at?: string;
  created_at?: string;
  archetype_id?: string;
  aspect_ratio?: AspectRatio;
  cells?: unknown[];
  // shared
  name?: string;
  path?: string;
  /** Whether the stored path still exists on disk (real project.list only).
   *  Absent on mock/full-Project rows → treated as present. */
  exists?: boolean;
}

export const projectApi = {
  open:   (c: McpClient, path: string) =>
    c.callTool<{ project_id: string }>('project.open', { path }),
  close:  (c: McpClient, project_id: string) =>
    c.callTool<{ closed: boolean }>('project.close', { project_id }),
  list:   (c: McpClient) =>
    c.callTool<{ projects: RawRecentProject[] }>('project.list'),
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
  /** Read the open project's Fountain screenplay source (<root>/script.fountain).
   *  `exists:false` (empty text) = the project has no .fountain on disk yet. */
  read_fountain: (c: McpClient) =>
    c.callTool<FountainRead>('storyboard.read_fountain'),
  /** Read the cell's REAL authored source file (the markup at its content_path).
   *  `exists:false` (empty html) = a cell with no source written yet. */
  read_cell_content: (c: McpClient, cell_uid: string) =>
    c.callTool<CellContent>('storyboard.read_cell_content', { cell_uid }),
  /** Persist the FULL edited html to the cell's content_path (durable save). */
  write_cell_content: (c: McpClient, cell_uid: string, html: string) =>
    c.callTool<{ content_path: string; bytes: number }>('storyboard.write_cell_content', { cell_uid, html }),
  write_cell:  (c: McpClient, cell_uid: string, patch: Partial<Cell>) =>
    c.callTool<Cell>('storyboard.write_cell', { cell_uid, patch }),
  /** Create a new cell from a full Cell record (Canvas "New cell"). The active
   *  project is injected real-side; the sidecar validates against CellSchema and
   *  scaffolds the on-disk cell dir. */
  create_cell: (c: McpClient, cell: Cell) =>
    c.callTool<{ cell: Cell }>('storyboard.create_cell', { cell }),
  /** Delete a cell by uid. Removes the record from storyboard.json; the on-disk
   *  cell dir is left in place (sidecar deleteCell — content files stay). */
  delete_cell: (c: McpClient, cell_uid: string) =>
    c.callTool<{ cellId: string }>('storyboard.delete_cell', { cell_uid }),
  list_cells:  (c: McpClient, args?: { beat_id?: string; rung?: Rung }) =>
    c.callTool<{ cells: Cell[] }>('storyboard.list_cells', args ?? {}),
  set_approved:(c: McpClient, cell_uid: string, approved: boolean) =>
    c.callTool<{ ok: true }>('storyboard.set_approved', { cell_uid, approved }),
};

/** A cell's authored source file (storyboard.read_cell_content). `exists:false`
 *  (empty html) is a real cell with no source written yet, NOT an error. */
export interface CellContent {
  html: string;
  content_path: string;
  exists: boolean;
}

/** The project's Fountain screenplay (storyboard.read_fountain). `exists:false`
 *  (empty text) is a project with no script.fountain on disk, NOT an error. */
export interface FountainRead {
  exists: boolean;
  text: string;
}

export const anchorApi = {
  list: (c: McpClient) =>
    c.callTool<{ anchors: Anchor[] }>('anchor.list'),
};

export const compositionApi = {
  // `cell_uid` scopes a render to a single cell (per-cell re-render / retry).
  // Omitting it renders the whole composition. The mock already keys off
  // `cell_uid`; the real WP-06 server honors the same arg.
  render: (c: McpClient, args: { project_id: string; cell_uid?: string; engine?: string; aspect_ratio?: AspectRatio; rung?: Rung }) =>
    c.callTool<{ record_id: string }>('composition.render', args),
  preview: (c: McpClient, args: { project_id: string; engine?: string }) =>
    c.callTool<{ preview_uri: string }>('composition.preview', args),
  validate: (c: McpClient, args: { project_id: string; engine?: string }) =>
    c.callTool<{ valid: boolean; diagnostics: Array<{ severity: 'error' | 'warn'; message: string }> }>('composition.validate', args),
};

/** Bytes-over-bridge preview payload (render/export → base64 → blob:). The
 *  `base64` may be empty in mock/standalone mode (no real mp4 on disk) — the
 *  caller falls back to the poster/status preview when so. */
export interface MediaBytes {
  base64: string;
  mime: string;
  sizeBytes: number;
  path: string;
}

/** Pre-flight audio-bed check (F7 silent-bed honesty). */
export interface BedCheck {
  has_bed: boolean;
  will_be_silent: boolean;
  by_design: boolean;
  path?: string;
}

export const renderApi = {
  list_engines: (c: McpClient) =>
    c.callTool<{ engines: EngineCapability[] }>('render.list_engines'),
  status:       (c: McpClient, record_id: string) =>
    c.callTool<RenderRecord>('render.status', { record_id }),
  cancel:       (c: McpClient, record_id: string) =>
    c.callTool<{ cancelled: boolean }>('render.cancel', { record_id }),
  list:         (c: McpClient, args?: { cell_uid?: string; status?: string }) =>
    c.callTool<{ records: RenderRecord[] }>('render.list', args ?? {}),
  read_bytes:   (c: McpClient, record_id: string) =>
    c.callTool<MediaBytes>('render.read_bytes', { record_id }),
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
  save_custom: (c: McpClient, args: { archetype_id: string; name: string; chain: Array<{ block_id: string; bindings?: Record<string, unknown> }>; description: string }) =>
    c.callTool<{ archetype_id: string }>('archetype.save_custom', args),
};

export const exportApi = {
  compose: (c: McpClient, args: { project_id: string; rung?: Rung; music_preset?: string; output_path?: string }) =>
    c.callTool<{ export_id: string; export_path: string }>('export.compose', args),
  status:  (c: McpClient, export_id: string) =>
    c.callTool<ExportRecord>('export.status', { export_id }),
  list:    (c: McpClient) =>
    c.callTool<{ exports: ExportRecord[] }>('export.list'),
  read_bytes: (c: McpClient, export_id: string) =>
    c.callTool<MediaBytes>('export.read_bytes', { export_id }),
  check_bed:  (c: McpClient, args: { project_id: string; music_preset?: string }) =>
    c.callTool<BedCheck>('export.check_bed', args),
};
