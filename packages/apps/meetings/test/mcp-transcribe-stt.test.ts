import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMeetingsMcpServer } from '../mcp/src/index.js';
import { WhisperSupervisor } from '../mcp/src/whisper.js';
import { clearOpenAiKey } from '../mcp/src/secrets-store.js';

/**
 * WP-19 DoD: "each provider transcribes the same 10-second recording and
 * produces segments." The 'local' path is already covered end-to-end by
 * test/mcp-transcribe.test.ts (WP-17); this file covers the 'openai' and
 * 'engine' branches of the same `transcribe` tool, and the new
 * stt_status/stt_set_openai_key/stt_clear_openai_key tools.
 *
 * `IKENGA_MEETINGS_STT_STORE_DIR` is set to a tmpdir before ANY import of
 * `mcp/src/secrets-store.js`, so nothing here ever touches this machine's
 * real `~/.ikenga`. Global `fetch` is monkey-patched rather than reaching
 * out to the real OpenAI API — this suite runs offline, in CI, and under an
 * isolated HOME with no network.
 */
describe('com.ikenga.meetings MCP — STT provider abstraction (WP-19)', () => {
  let storeDir: string;
  let tmpDir: string;
  let originalFetch: typeof fetch;

  before(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetings-stt-store-'));
    process.env.IKENGA_MEETINGS_STT_STORE_DIR = storeDir;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetings-stt-media-'));
    originalFetch = globalThis.fetch;
  });

  after(async () => {
    delete process.env.IKENGA_MEETINGS_STT_STORE_DIR;
    globalThis.fetch = originalFetch;
    await fs.rm(storeDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = originalFetch;
    // Each test starts from "no key configured" — otherwise a key set by an
    // earlier test (or one an earlier test left behind after its own
    // assertion failed midway) leaks into the next test's fetch mock, or
    // worse, into a real network call.
    await clearOpenAiKey();
  });

  async function connect() {
    const server = createMeetingsMcpServer(new WhisperSupervisor());
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return { client, server };
  }

  it('lists the new stt_* tools alongside the existing transcribe tools', async () => {
    const { client, server } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes('stt_status'));
    assert.ok(tools.includes('stt_set_openai_key'));
    assert.ok(tools.includes('stt_clear_openai_key'));
    await client.close();
    await server.close();
  });

  it('stt_status reports openai as unconfigured until a key is set, then configured', async () => {
    const { client, server } = await connect();

    const before1 = await client.callTool({ name: 'stt_status', arguments: {} });
    const beforeParsed = JSON.parse((before1.content as Array<{ text: string }>)[0]!.text);
    assert.equal(beforeParsed.openai.configured, false);

    const setRes = await client.callTool({
      name: 'stt_set_openai_key',
      arguments: { api_key: 'sk-integration-test' },
    });
    assert.equal(setRes.isError, false);

    const after1 = await client.callTool({ name: 'stt_status', arguments: {} });
    const afterParsed = JSON.parse((after1.content as Array<{ text: string }>)[0]!.text);
    assert.equal(afterParsed.openai.configured, true);

    const clearRes = await client.callTool({ name: 'stt_clear_openai_key', arguments: {} });
    assert.equal(clearRes.isError, false);
    const after2 = await client.callTool({ name: 'stt_status', arguments: {} });
    const afterParsed2 = JSON.parse((after2.content as Array<{ text: string }>)[0]!.text);
    assert.equal(afterParsed2.openai.configured, false);

    await client.close();
    await server.close();
  });

  it("transcribes a 10-second recording via provider:'openai' once a key is configured", async () => {
    const meetingId = crypto.randomUUID();
    const mediaDir = path.join(tmpDir, 'media', meetingId);
    await fs.mkdir(mediaDir, { recursive: true });
    const audioPath = path.join(mediaDir, 'audio.wav');
    // Stand-in for a 10-second WAV — the OpenAI path never inspects duration,
    // only that the file exists and is non-empty (real duration is asserted
    // by the WP-11 capture graph, out of scope here).
    await fs.writeFile(audioPath, Buffer.alloc(1024, 1));

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      assert.equal(auth, 'Bearer sk-openai-e2e-test');
      return new Response(
        JSON.stringify({
          segments: [{ text: 'This is a ten second test recording.', start: 0, end: 10 }],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const { client, server } = await connect();
    await client.callTool({
      name: 'stt_set_openai_key',
      arguments: { api_key: 'sk-openai-e2e-test' },
    });

    const result = await client.callTool({
      name: 'transcribe',
      arguments: {
        meeting_id: meetingId,
        audio_path: audioPath,
        provider: 'openai',
      },
    });

    assert.equal(result.isError, false);
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.meeting_id, meetingId);
    assert.equal(parsed.segment_count, 1);
    assert.equal(parsed.segments[0].text, 'This is a ten second test recording.');

    await client.close();
    await server.close();
  });

  it("fails clearly when provider:'openai' is requested with no key configured", async () => {
    const meetingId = crypto.randomUUID();
    const mediaDir = path.join(tmpDir, 'media', meetingId);
    await fs.mkdir(mediaDir, { recursive: true });
    const audioPath = path.join(mediaDir, 'audio.wav');
    await fs.writeFile(audioPath, Buffer.alloc(1024, 1));

    const { client, server } = await connect();
    const result = await client.callTool({
      name: 'transcribe',
      arguments: { meeting_id: meetingId, audio_path: audioPath, provider: 'openai' },
    });

    assert.equal(result.isError, true);
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /no OpenAI API key configured/);

    await client.close();
    await server.close();
  });

  it("fails clearly and specifically when provider:'engine' is requested — this server has no path to the shell's agent session", async () => {
    const { client, server } = await connect();
    const result = await client.callTool({
      name: 'transcribe',
      arguments: { meeting_id: crypto.randomUUID(), provider: 'engine' },
    });

    assert.equal(result.isError, true);
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /not reachable from the meetings MCP server/);

    await client.close();
    await server.close();
  });
});
