/**
 * OpenRouter Unified LLM Engine Adapter (WP-20).
 *
 * A real, self-contained HTTP transport for OpenRouter's OpenAI-compatible
 * `/chat/completions` endpoint: streaming SSE, reasoning-token normalization
 * (G-54 — both the `delta.reasoning`/`delta.thinking` field form and the
 * inline `<think>…</think>` form), and OpenAI-shape tool-call delta
 * accumulation. Model selection is free text end-to-end — no pinned roster
 * (Plan 24 §5.1).
 *
 * See `http-engine.ts` for the API-key binding story (F-9 settings-secret env
 * today; shell-side Stronghold read once the Rust HTTP-engine adapter lands).
 */

import type { Engine } from '@ikenga/contract/engine';

import { createHttpEngine, type OpenRouterEngineConfig } from './http-engine.js';

export * from './stream.js';
export * from './transport.js';
export * from './http-engine.js';
export * from './acp-engine.js';

/**
 * Primary factory. Unlike the CLI-wrapping engine pkgs there is no HostBridge
 * here — the transport is in-process HTTP, so the factory takes plain config
 * (all optional; the API key defaults to the F-9-injected
 * `process.env.OPENROUTER_API_KEY`).
 */
export function createEngine(config?: OpenRouterEngineConfig): Engine {
  return createHttpEngine(config);
}
