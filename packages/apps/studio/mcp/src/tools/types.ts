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

// ─────────────────────────────────────────────────────────────────────────
// G2 engine capability table (hardcoded for P1; moves to a self-registering
// registry once WP-05/WP-05b ship).
// ─────────────────────────────────────────────────────────────────────────

export interface EngineCapability {
  id: string;
  capabilities: {
    still: boolean;
    video: boolean;
    interactive: boolean;
    range: boolean;
    combine: boolean;
    aspect_ratios: Array<'16:9' | '9:16' | '1:1'>;
    /** ms; null = unbounded. */
    max_duration_ms: number | null;
    supported_codecs: string[];
    requires_network: boolean;
  };
}

export const P1_ENGINE_CAPABILITIES: EngineCapability[] = [
  {
    id: 'hyperframes',
    capabilities: {
      still: false,
      video: true,
      interactive: false,
      range: true,
      combine: false,
      aspect_ratios: ['16:9', '9:16', '1:1'],
      max_duration_ms: null,
      supported_codecs: ['h264'],
      requires_network: false,
    },
  },
  {
    id: 'excalidraw',
    capabilities: {
      still: true,
      video: true,
      interactive: false,
      range: false,
      combine: false,
      aspect_ratios: ['16:9', '9:16', '1:1'],
      max_duration_ms: null,
      supported_codecs: ['h264', 'png'],
      requires_network: false,
    },
  },
];

/**
 * G23: resolve an `engine` (which may be undefined or `'auto'`) from a
 * cell's `content_path` extension.
 *
 * Returns either a concrete adapter id known to P1, or a `ToolResult`
 * shaped failure that should be returned to the caller verbatim.
 */
export function resolveEngineForContentPath(
  contentPath: string | undefined,
  requested: string | undefined,
): { ok: true; engine: string } | { ok: false; error: string; message?: string } {
  if (requested && requested !== 'auto') {
    // Honor explicit pick; still range-check P1 availability for `.tsx`/Remotion.
    if (requested === 'remotion') {
      return { ok: false, error: 'engine-not-available-in-p1', message: 'remotion is P2' };
    }
    return { ok: true, engine: requested };
  }
  const ext = (contentPath ?? '').toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
  switch (ext) {
    case 'html':
      return { ok: true, engine: 'hyperframes' };
    case 'tsx':
      return { ok: false, error: 'engine-not-available-in-p1', message: 'remotion is P2' };
    case 'excalidraw':
      return { ok: true, engine: 'excalidraw' };
    default:
      return { ok: false, error: 'unresolvable-engine', message: `no adapter for extension ${ext || '(none)'}` };
  }
}
