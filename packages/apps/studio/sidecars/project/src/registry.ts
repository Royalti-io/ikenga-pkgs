/**
 * Adapter registry (WP-03b).
 *
 * The single place the sidecar resolves a renderer adapter by id and the
 * single source of the G2 capability matrix that `render.list_engines`
 * surfaces. WP-05 (hyperframes) + WP-05b (excalidraw) ship the concrete
 * adapters; this module imports them and exposes lookup + engine resolution.
 *
 * G23 — content-path → engine auto-resolution. The order is fixed
 * (`.html → hyperframes`, `.excalidraw → excalidraw`, `.tsx → remotion`
 * [rejected as P2], else throw). This mirrors the MCP-layer RenderShim
 * resolution that WP-06 implemented in-MCP, but now lives at the sidecar
 * enqueue boundary so it is enforced regardless of caller.
 */

import { hyperframesAdapter } from './renderers/hyperframes.js';
import { excalidrawAdapter } from './renderers/excalidraw.js';
import type { RendererAdapter } from './renderers/types.js';

const ADAPTERS: RendererAdapter[] = [hyperframesAdapter, excalidrawAdapter];

const BY_ID = new Map<string, RendererAdapter>(ADAPTERS.map((a) => [a.id, a]));

export function getAdapter(id: string): RendererAdapter | undefined {
  return BY_ID.get(id);
}

export interface EngineDescriptor {
  id: string;
  capabilities: RendererAdapter['capabilities'];
}

/**
 * The real G2 matrix, sourced from each adapter's own `.capabilities`. This
 * is what `render.list_engines` returns — it replaces WP-06's hardcoded
 * `P1_ENGINE_CAPABILITIES` array (the response shape is identical so the
 * MCP swap is transparent).
 */
export function listEngines(): EngineDescriptor[] {
  return ADAPTERS.map((a) => ({ id: a.id, capabilities: a.capabilities }));
}

/** Error thrown by `resolveEngine` when no adapter matches the content path. */
export class EngineResolutionError extends Error {
  code: 'engine-not-available-in-p1' | 'unresolvable-engine';
  constructor(
    code: 'engine-not-available-in-p1' | 'unresolvable-engine',
    message: string,
  ) {
    super(message);
    this.name = 'EngineResolutionError';
    this.code = code;
  }
}

function extOf(contentPath: string): string {
  return contentPath.toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
}

/**
 * G23 — resolve a concrete engine id from a cell's `content_path`. Throws an
 * `EngineResolutionError` (honest domain error) for `.tsx` (Remotion is P2)
 * and for unknown extensions.
 */
export function resolveEngine(contentPath: string): string {
  const ext = extOf(contentPath);
  switch (ext) {
    case 'html':
      return 'hyperframes';
    case 'excalidraw':
      return 'excalidraw';
    case 'tsx':
      throw new EngineResolutionError('engine-not-available-in-p1', 'remotion is P2');
    default:
      throw new EngineResolutionError(
        'unresolvable-engine',
        `no adapter for extension ${ext || '(none)'}`,
      );
  }
}

/**
 * Resolve a possibly-explicit engine pick + content path into a concrete
 * engine id, honoring `auto`/undefined → G23 auto-resolution. Returns the
 * concrete id or throws `EngineResolutionError`.
 */
export function resolveEngineWithRequest(
  contentPath: string,
  requested: string | undefined,
): string {
  if (requested && requested !== 'auto') {
    if (requested === 'remotion') {
      throw new EngineResolutionError('engine-not-available-in-p1', 'remotion is P2');
    }
    if (!BY_ID.has(requested)) {
      throw new EngineResolutionError('unresolvable-engine', `unknown engine ${requested}`);
    }
    return requested;
  }
  return resolveEngine(contentPath);
}
