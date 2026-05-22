/**
 * Shared tool types for the studio MCP server.
 *
 * Every tool returns a `ToolResult` — `{ ok: true, ... }` for success or
 * `{ ok: false, error, message? }` for structured failures. The MCP server
 * adapter at index.ts wraps these as `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.
 */

export type ToolResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; error: string; message?: string };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * In-MCP record of open projects. Used by tools that need the project root
 * path (e.g. asset/composition/catalog tools that resolve filesystem
 * paths) without a round-trip to the sidecar on every call.
 */
export interface OpenProjectEntry {
  /** Absolute path to the project root. */
  path: string;
  /** Parsed Project JSON as returned by the sidecar (opaque to most tools). */
  project: unknown;
}

export interface OpenProjectRegistry {
  set(projectId: string, entry: OpenProjectEntry): void;
  get(projectId: string): OpenProjectEntry | undefined;
  delete(projectId: string): boolean;
  values(): IterableIterator<OpenProjectEntry>;
  keys(): IterableIterator<string>;
}

// NOTE (WP-03b): the former hardcoded `P1_ENGINE_CAPABILITIES` table and the
// in-MCP `resolveEngineForContentPath` G23 resolver were REMOVED. Engine
// resolution (G23) + the capability matrix (G2) now live in the sidecar
// registry (`render.list_engines` / `render.enqueue`); the MCP forwards
// rather than duplicating that logic.
