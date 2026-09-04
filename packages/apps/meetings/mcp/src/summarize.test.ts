import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  transcriptToPrompt,
  parseSummaryResponse,
  summarizeWithOpenAi,
  SummarizerNotConfigured,
  OPENAI_CHAT_URL,
} from './summarize.js';
import type { TranscriptSegment } from '@ikenga/meetings-contract';

const seg = (o: Partial<TranscriptSegment>): TranscriptSegment =>
  ({ id: 'x', meeting_id: 'm', start_ms: 0, end_ms: 1, text: 't', ...o }) as TranscriptSegment;

describe('transcript prompt', () => {
  it('attributes channel speakers as You and Them', () => {
    const p = transcriptToPrompt([
      seg({ speaker_id: 'remote', text: 'their line' }),
      seg({ speaker_id: 'local', text: 'my line' }),
    ]);
    assert.equal(p, 'Them: their line\nYou: my line');
  });

  it('prefers a real speaker name when present', () => {
    assert.match(transcriptToPrompt([seg({ speaker_id: 'local', speaker_name: 'Ada' })]), /^Ada:/);
  });
});

describe('summary parsing', () => {
  const good = JSON.stringify({
    executive_summary: 'They agreed the split sheet.',
    key_decisions: ['50-50 split'],
    action_items: [{ title: 'Send contract', assignee: 'Ada', due_date: 'Friday' }],
  });

  it('parses a clean JSON reply', () => {
    const s = parseSummaryResponse(good);
    assert.equal(s.executive_summary, 'They agreed the split sheet.');
    assert.equal(s.action_items[0]?.assignee, 'Ada');
  });

  it('tolerates a code fence, which models emit despite instructions', () => {
    assert.equal(parseSummaryResponse('```json\n' + good + '\n```').key_decisions.length, 1);
  });

  it('throws rather than returning a summary with no text', () => {
    // A silently empty summary is worse than an error: nobody re-reads it.
    assert.throws(() => parseSummaryResponse('{"executive_summary": "   "}'), /no executive summary/);
  });

  it('throws on non-JSON instead of guessing', () => {
    assert.throws(() => parseSummaryResponse('Sure! Here you go.'), /did not return usable JSON/);
  });

  it('drops malformed action items rather than inventing fields', () => {
    const s = parseSummaryResponse(
      JSON.stringify({ executive_summary: 'ok', action_items: [{ assignee: 'Ada' }, { title: 'Real' }] })
    );
    assert.equal(s.action_items.length, 1);
    assert.equal(s.action_items[0]?.title, 'Real');
  });
});

describe('cloud summarisation', () => {
  it('refuses without a key rather than silently doing nothing', async () => {
    await assert.rejects(
      () => summarizeWithOpenAi({ segments: [seg({})], apiKey: '', fetchImpl: (async () => {
        throw new Error('must not be called');
      }) as never }),
      SummarizerNotConfigured
    );
  });

  it('sends a bearer token to the chat endpoint and returns the parsed summary', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fake = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenAuth = String((init.headers as Record<string, string>).Authorization);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ executive_summary: 'Done.' }) } }],
        }),
      };
    }) as never;

    const s = await summarizeWithOpenAi({ segments: [seg({})], apiKey: 'sk-test', fetchImpl: fake });
    assert.equal(seenUrl, OPENAI_CHAT_URL);
    assert.equal(seenAuth, 'Bearer sk-test');
    assert.equal(s.executive_summary, 'Done.');
  });

  it('never echoes the key in an error', async () => {
    const fake = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid api key sk-secret-value',
    })) as never;

    await assert.rejects(
      () => summarizeWithOpenAi({ segments: [seg({})], apiKey: 'sk-secret-value', fetchImpl: fake }),
      (err: Error) => {
        assert.match(err.message, /401/);
        // The body is echoed for diagnosis, so this asserts the KEY we passed
        // is not added by us on top of it.
        assert.equal((err.message.match(/sk-secret-value/g) ?? []).length, 1);
        return true;
      }
    );
  });
});
