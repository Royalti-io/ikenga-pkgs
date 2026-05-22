// G-ADAPTER trait — frozen on sign-off. Downstream adapters (WP-05/05b/07c)
// and the MCP server (WP-06) implement or call this; do NOT mutate without
// re-running the gate.
//
// Pure declaration module: no runtime code, no functions, no constants.
// Schema imports are `import type` only — this file has zero runtime
// dependency on `@ikenga/studio-schema`.

import type { AspectRatio, Cell, RenderRecord } from '@ikenga/studio-schema';

/**
 * URL the sub-view loads to display a preview frame. May be an HTTP(S) URL,
 * a `file://` path, or a pkg-scoped `pkg://` URL — the host resolves all
 * three. Adapters should return the cheapest representation they can
 * produce; large previews should stream rather than inline-encode.
 */
export type PreviewURL = string;

/**
 * Minimal cell-validation finding emitted by `RendererAdapter.validate`.
 * Surfaced to the iframe UI as inline diagnostics on the affected cell.
 */
export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Optional dot-path into the cell that the diagnostic points at. */
  path?: string;
}

/**
 * Per-render options the caller threads to `render` (and `combine`).
 *
 * G1 (aspect ratio): when omitted, the adapter falls back to
 * `RenderContext.aspectRatio` (the project default). Adapters that cannot
 * honor the requested ratio MUST surface a `Diagnostic` from `validate`
 * rather than silently re-cropping.
 */
export interface RenderOptions {
  aspect_ratio?: AspectRatio;
  resolution?: { w: number; h: number };
  /** Adapter-specific variant id (e.g. model preset, quality tier). */
  variant?: string;
}

/**
 * Per-invocation context the host hands to every adapter call. Carries
 * project paths, the project default framing, the vault read surface, the
 * pkg-event emitter, and the cancellation signal.
 */
export interface RenderContext {
  /** Absolute path to the project root on disk. */
  projectRoot: string;
  /** Absolute path to the cell's working directory. */
  cellDir: string;
  /** Absolute path to the renders output directory for this cell/project. */
  rendersDir: string;
  /** Project-default aspect ratio (G1). Adapters fall back to this when `RenderOptions.aspect_ratio` is omitted. */
  aspectRatio: AspectRatio;
  /** Project-default resolution. Paired with `aspectRatio` and overridable via `RenderOptions.resolution`. */
  resolution: { w: number; h: number };
  /**
   * Read-only window onto the Stronghold vault — the minimum surface an
   * adapter needs to fetch API keys / tokens. Do NOT widen this here; the
   * full vault interface belongs to the host.
   */
  vault: { get(key: string): Promise<string | undefined> };
  /** Pkg-event emitter. Adapters call this with `render.progress` etc. */
  emit: (event: { type: string; payload?: unknown }) => void;
  /** Cancellation signal. Adapters MUST observe this and abort in-flight work. */
  signal: AbortSignal;
}

/**
 * Renderer adapter contract.
 *
 * Each engine (hyperframes, remotion, kling, sora, …) implements this
 * trait. The MCP server (WP-06) discovers adapters by `id` and selects one
 * per render call; the iframe UI uses `capabilities` (G2) to grey-out
 * invalid combos and the agent uses it to pick a valid engine without a
 * failed round-trip.
 */
export interface RendererAdapter {
  /**
   * Stable adapter id, e.g. `"hyperframes"` or `"remotion"`. Used by the
   * MCP layer to route render calls and by G23 auto-resolution to pick
   * a default when the project does not pin one.
   */
  readonly id: string;

  /**
   * Capability descriptor (G2) — purely declarative discovery primitives.
   * The UI reads these to grey-out invalid combos; the agent reads them
   * to pick a valid engine without a failed render round-trip.
   */
  readonly capabilities: {
    still: boolean;
    video: boolean;
    interactive: boolean;
    range: boolean;
    combine: boolean;
    /** Output framings this engine supports (G1). */
    aspect_ratios: AspectRatio[];
    /** Per-clip cap in milliseconds (Kling 3.0 ≈ 10000, Sora 2 ≈ 25000). `null` = unbounded. */
    max_duration_ms: number | null;
    /** Output codecs the engine can emit, e.g. `['h264', 'hevc', 'av1']`. */
    supported_codecs: string[];
    /** AI adapters: true. Local/deterministic adapters (HF, Excalidraw): false. */
    requires_network: boolean;
  };

  /** Static + light-runtime validation of a cell against this engine. Surfaces inline diagnostics. */
  validate(cell: Cell, ctx: RenderContext): Promise<Diagnostic[]>;

  /** Produce a preview frame URL for the cell. Should be cheap and cacheable. */
  preview(cell: Cell, ctx: RenderContext): Promise<PreviewURL>;

  /** Produce the final render artifact for the cell. Long-running; must observe `ctx.signal`. */
  render(cell: Cell, opts: RenderOptions, ctx: RenderContext): Promise<RenderRecord>;

  /**
   * Optional: stitch multiple render records into a single composite
   * (e.g. multi-clip remotion compose). Adapters that don't support
   * combine omit this method; `capabilities.combine` MUST agree.
   */
  combine?(records: RenderRecord[], opts: RenderOptions, ctx: RenderContext): Promise<RenderRecord>;

  /**
   * Optional: cooperative cancel by record id. The host also signals via
   * `ctx.signal`; this hook is for adapters that need to call a
   * provider-side cancel endpoint.
   */
  cancel?(recordId: string): Promise<void>;
}
