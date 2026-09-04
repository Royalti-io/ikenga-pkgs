import type { TranscriptSegment } from '@ikenga/meetings-contract';
import { getOpenAiKey } from './secrets-store.js';

/**
 * WP-22 — LLM summarisation, opt-in per meeting (D-16).
 *
 * The rule-based summariser in the app produces things like "Meeting covered 16
 * spoken segments. Key discussion centered around Audio & Deliverables." That is
 * a spine, not a summary. This is the real one.
 *
 * ── Why OpenAI and not Chi ────────────────────────────────────────────────
 *
 * D-16 said "route it through Chi / an LLM". Chi is not reachable: the verb
 * studio's `sendToChi` calls — `host.sendToActiveSession` — appears in comments
 * in `pkg-iframe-host.tsx` but is **not implemented as a dispatch case**
 * anywhere in the shell. Verified 2026-09-04 by grepping for its handler. So a
 * pkg iframe has no working path to an agent session today, and building
 * against one would ship a button that cannot work.
 *
 * What does exist is the OpenAI client and key store WP-19 built for
 * transcription, and `permissions.net` already allows `api.openai.com`. This
 * reuses both rather than opening a second credential surface.
 *
 * ── Why this never runs on its own ───────────────────────────────────────
 *
 * Summarising sends the whole transcript off the machine. The local rule-based
 * pass may run automatically because it does not; this may not. It is invoked
 * per meeting, by a person, after being told where the text is going.
 */

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/** Default model. Cheap and adequate for meeting summarisation; overridable. */
export const DEFAULT_SUMMARY_MODEL = 'gpt-4o-mini';

export interface LlmSummary {
  executive_summary: string;
  key_decisions: string[];
  action_items: Array<{ title: string; assignee?: string; due_date?: string }>;
}

export class SummarizerNotConfigured extends Error {
  constructor() {
    super(
      'No OpenAI API key is configured, so this meeting cannot be summarised in the cloud. ' +
        'Add a key in the transcription settings, or keep using the local summary.'
    );
    this.name = 'SummarizerNotConfigured';
  }
}

/** Flatten a transcript into speaker-attributed lines the model can follow. */
export function transcriptToPrompt(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const who =
        s.speaker_name ??
        (s.speaker_id === 'local' ? 'You' : s.speaker_id === 'remote' ? 'Them' : 'Speaker');
      return `${who}: ${s.text.trim()}`;
    })
    .join('\n');
}

/**
 * Parse the model's reply into a summary.
 *
 * Tolerates a fenced code block, which models emit despite being asked not to.
 * Throws rather than returning a half-empty summary — a silently degraded
 * summary of a meeting is worse than an error, because nobody re-reads it.
 */
export function parseSummaryResponse(content: string, ): LlmSummary {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? content).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The model did not return usable JSON: ${raw.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.executive_summary === 'string' ? obj.executive_summary.trim() : '';
  if (!summary) throw new Error('The model returned no executive summary.');

  const decisions = Array.isArray(obj.key_decisions)
    ? obj.key_decisions.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];

  const items = Array.isArray(obj.action_items)
    ? obj.action_items
        .map((raw) => {
          const a = raw as Record<string, unknown>;
          const title = typeof a?.title === 'string' ? a.title.trim() : '';
          if (!title) return null;
          return {
            title,
            ...(typeof a.assignee === 'string' && a.assignee.trim()
              ? { assignee: a.assignee.trim() }
              : {}),
            ...(typeof a.due_date === 'string' && a.due_date.trim()
              ? { due_date: a.due_date.trim() }
              : {}),
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : [];

  return { executive_summary: summary, key_decisions: decisions, action_items: items };
}

const SYSTEM_PROMPT = [
  'You summarise meeting transcripts. Be concrete and brief.',
  'Report only what was actually said — never infer commitments nobody made.',
  'If the transcript is too short or too garbled to summarise, say so in',
  'executive_summary and return empty arrays rather than inventing content.',
  'Respond with JSON only, no prose, no code fence, shaped as:',
  '{"executive_summary": string, "key_decisions": string[],',
  ' "action_items": [{"title": string, "assignee"?: string, "due_date"?: string}]}',
].join(' ');

export async function summarizeWithOpenAi(opts: {
  segments: TranscriptSegment[];
  model?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<LlmSummary> {
  const key = opts.apiKey ?? (await getOpenAiKey());
  if (!key) throw new SummarizerNotConfigured();

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_SUMMARY_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcriptToPrompt(opts.segments) },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Never echo the key, even from an error body.
    throw new Error(
      `OpenAI summarisation failed: HTTP ${res.status} ${res.statusText}. ${body.slice(0, 300)}`
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no summary content.');

  return parseSummaryResponse(content);
}
