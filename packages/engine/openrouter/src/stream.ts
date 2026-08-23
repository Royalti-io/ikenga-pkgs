/**
 * OpenRouter SSE Streaming Normalizer (WP-20, G-54).
 *
 * Normalizes OpenRouter SSE streaming chunks into standard EngineEvent types.
 *
 * Specifically normalizes:
 *   - `delta.content` → `{ type: 'message_delta', text }`
 *   - `delta.reasoning` / `delta.thinking` → `{ type: 'thinking_delta', text }` (G-54)
 *   - `delta.tool_calls` → `{ type: 'tool_use', tool, input, toolUseId }`
 *   - `usage` → `{ type: 'usage', inputTokens, outputTokens, ... }`
 *   - `finish_reason` → `{ type: 'done', reason }`
 */

import type { EngineEvent } from '@ikenga/contract/engine';

export interface OpenRouterDelta {
  content?: string | null;
  reasoning?: string | null;
  thinking?: string | null;
  tool_calls?: Array<{
    id?: string;
    index?: number;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface OpenRouterChoice {
  index: number;
  delta: OpenRouterDelta;
  finish_reason?: string | null;
}

export interface OpenRouterChunk {
  id?: string;
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: number | string;
  };
}

/**
 * Normalizes a parsed OpenRouter SSE chunk into zero or more standard EngineEvents.
 */
export function* normalizeOpenRouterChunk(chunk: OpenRouterChunk): Generator<EngineEvent> {
  if (chunk.error) {
    yield {
      type: 'done',
      reason: 'error',
      error: chunk.error.message || 'OpenRouter API stream error',
    };
    return;
  }

  // 1. Token usage reporting
  if (chunk.usage) {
    yield {
      type: 'usage',
      inputTokens: chunk.usage.prompt_tokens ?? 0,
      outputTokens: chunk.usage.completion_tokens ?? 0,
    };
  }

  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta;
    if (!delta) continue;

    // 2. Reasoning / Thinking delta (G-54)
    // DeepSeek R1 emits `delta.reasoning`, Claude 3.7 Sonnet thinking emits `delta.thinking`
    const reasoningText = delta.reasoning ?? delta.thinking;
    if (reasoningText) {
      yield {
        type: 'thinking_delta',
        text: reasoningText,
      };
    }

    // 3. Message delta
    if (delta.content) {
      yield {
        type: 'message_delta',
        text: delta.content,
      };
    }

    // 4. Tool call delta
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.function?.name && tc.id) {
          let parsedInput: unknown = tc.function.arguments;
          try {
            if (tc.function.arguments) {
              parsedInput = JSON.parse(tc.function.arguments);
            }
          } catch {
            // Keep raw string if partial
          }
          yield {
            type: 'tool_use',
            tool: tc.function.name,
            input: parsedInput,
            toolUseId: tc.id,
          };
        }
      }
    }

    // 5. Completion
    if (choice.finish_reason) {
      const reason =
        choice.finish_reason === 'stop'
          ? 'stop'
          : choice.finish_reason === 'tool_calls'
            ? 'stop'
            : choice.finish_reason === 'cancelled'
              ? 'cancel'
              : 'stop';
      yield {
        type: 'done',
        reason,
      };
    }
  }
}
