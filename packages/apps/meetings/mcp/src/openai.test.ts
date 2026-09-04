import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { parseOpenAiVerboseJson, transcribeWithOpenAi } from './openai.js';

describe('OpenAI Whisper backend (WP-19)', () => {
  describe('parseOpenAiVerboseJson', () => {
    it('maps verbose_json segments into TranscriptSegment shape', () => {
      const raw = {
        text: 'Hello world.',
        segments: [
          { text: 'Hello world.', start: 0.5, end: 2.25, avg_logprob: -0.1 },
        ],
      };
      const segments = parseOpenAiVerboseJson(raw, 'mtg-1');
      assert.equal(segments.length, 1);
      assert.equal(segments[0]?.meeting_id, 'mtg-1');
      assert.equal(segments[0]?.text, 'Hello world.');
      assert.equal(segments[0]?.start_ms, 500);
      assert.equal(segments[0]?.end_ms, 2250);
      assert.ok(segments[0]!.confidence > 0 && segments[0]!.confidence <= 1);
    });

    it('drops empty-text segments', () => {
      const raw = { segments: [{ text: '   ', start: 0, end: 1 }] };
      assert.equal(parseOpenAiVerboseJson(raw, 'mtg-2').length, 0);
    });

    it('falls back to top-level text when segments is absent', () => {
      const raw = { text: 'Just one blob of text.' };
      const segments = parseOpenAiVerboseJson(raw, 'mtg-3');
      assert.equal(segments.length, 1);
      assert.equal(segments[0]?.text, 'Just one blob of text.');
    });
  });

  describe('transcribeWithOpenAi', () => {
    let tmpDir: string;
    let audioPath: string;

    before(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetings-openai-test-'));
      audioPath = path.join(tmpDir, 'audio.wav');
      await fs.writeFile(audioPath, 'RIFFdummywavecontent1234567890');
    });

    after(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('sends the audio file and the key as a Bearer header, and parses the response', async () => {
      let capturedAuth: string | null = null;
      let capturedMethod: string | null = null;
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        capturedMethod = init?.method ?? null;
        capturedAuth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
        return new Response(
          JSON.stringify({
            segments: [{ text: 'Ten seconds of test audio.', start: 0, end: 10 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as typeof fetch;

      const result = await transcribeWithOpenAi({
        meetingId: 'mtg-real-key-test',
        audioPath,
        apiKey: 'sk-test-not-a-real-key',
        fetchImpl,
      });

      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedAuth, 'Bearer sk-test-not-a-real-key');
      assert.equal(result.segments.length, 1);
      assert.equal(result.segments[0]?.text, 'Ten seconds of test audio.');
      assert.equal(result.segments[0]?.meeting_id, 'mtg-real-key-test');
    });

    it('surfaces the response body on a non-2xx without echoing the key', async () => {
      const fetchImpl = (async () =>
        new Response('invalid_api_key', { status: 401 })) as typeof fetch;

      await assert.rejects(
        () =>
          transcribeWithOpenAi({
            meetingId: 'mtg-4',
            audioPath,
            apiKey: 'sk-should-never-appear-in-the-error',
            fetchImpl,
          }),
        (err: Error) => {
          assert.match(err.message, /401/);
          assert.match(err.message, /invalid_api_key/);
          assert.doesNotMatch(err.message, /sk-should-never-appear-in-the-error/);
          return true;
        }
      );
    });

    it('wraps a network failure with a clear message', async () => {
      const fetchImpl = (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;

      await assert.rejects(
        () =>
          transcribeWithOpenAi({
            meetingId: 'mtg-5',
            audioPath,
            apiKey: 'sk-test',
            fetchImpl,
          }),
        /could not reach OpenAI/
      );
    });
  });
});
