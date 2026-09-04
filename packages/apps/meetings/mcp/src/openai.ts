/**
 * OpenAI Whisper API backend (WP-19, D-17 option 2).
 *
 * User-supplied key, resolved by `./secrets-store.js`; this module never logs
 * the key and never returns it — only `Authorization: Bearer <key>` on the
 * one outbound request. Runs from the meetings MCP server process (a plain
 * Node child spawned by the shell), not from the iframe: the pkg's CSP
 * (`connect-src 'self' http://127.0.0.1:*`) would block this request from
 * the browser sandbox anyway, and the key must never reach that context.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { TranscriptSegment } from '@ikenga/meetings-contract';

export const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface OpenAiTranscribeOptions {
  meetingId: string;
  audioPath: string;
  apiKey: string;
  language?: string;
  /** Override for tests; defaults to the real OpenAI endpoint. */
  baseUrl?: string;
  /** Override for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface OpenAiTranscribeResult {
  segments: TranscriptSegment[];
}

export async function transcribeWithOpenAi(
  opts: OpenAiTranscribeOptions
): Promise<OpenAiTranscribeResult> {
  const { meetingId, audioPath, apiKey, language } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const url = opts.baseUrl ?? OPENAI_TRANSCRIPTIONS_URL;

  const buf = await fs.readFile(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(audioPath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language);

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new Error(
      `could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Never echo the key; only the response's own status/body.
    throw new Error(`OpenAI transcription failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  return { segments: parseOpenAiVerboseJson(json, meetingId) };
}

/** Parses OpenAI's `verbose_json` transcription response. Exported for tests
 *  so the segment mapping is checkable without a real network call. */
export function parseOpenAiVerboseJson(json: unknown, meetingId: string): TranscriptSegment[] {
  const obj = (json ?? {}) as {
    segments?: Array<{ text?: string; start?: number; end?: number; avg_logprob?: number }>;
    text?: string;
  };
  const segments: TranscriptSegment[] = [];
  for (const seg of obj.segments ?? []) {
    const text = (seg.text ?? '').trim();
    if (!text) continue;
    const startMs = Math.max(0, Math.round((seg.start ?? 0) * 1000));
    const endMs = Math.max(startMs, Math.round((seg.end ?? 0) * 1000));
    // `avg_logprob` is a log-probability (≤ 0); this is a rough, monotonic
    // stand-in for the 0..1 confidence whisper.cpp reports natively, not a
    // calibrated value — good enough to sort/flag, not to publish as exact.
    const confidence =
      typeof seg.avg_logprob === 'number' ? Math.max(0, Math.min(1, 1 + seg.avg_logprob)) : 1.0;
    segments.push({
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      speaker_source: 'dom_cue',
      start_ms: startMs,
      end_ms: endMs,
      text,
      confidence,
    });
  }
  // Some responses omit `segments` and carry only top-level `text`.
  if (segments.length === 0 && typeof obj.text === 'string' && obj.text.trim()) {
    segments.push({
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      speaker_source: 'dom_cue',
      start_ms: 0,
      end_ms: 0,
      text: obj.text.trim(),
      confidence: 1.0,
    });
  }
  return segments;
}
