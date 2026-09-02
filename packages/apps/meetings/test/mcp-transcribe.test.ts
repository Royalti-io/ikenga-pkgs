import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMeetingsMcpServer } from '../mcp/src/index.js';
import { WhisperSupervisor, parseWhisperCppJson, isProcessAlive } from '../mcp/src/whisper.js';

describe('com.ikenga.meetings Supervised MCP Server (WP-17)', () => {
  let tmpDir: string;
  let mockWhisperBin: string;
  let mockSlowWhisperBin: string;
  let mockModelDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetings-mcp-test-'));
    mockModelDir = path.join(tmpDir, 'models');
    await fs.mkdir(mockModelDir, { recursive: true });

    // Create a mock model file
    const modelPath = path.join(mockModelDir, 'ggml-small.en.bin');
    await fs.writeFile(modelPath, 'mock-model-weights');

    // Create a mock whisper-cli node script that succeeds and produces .transcript.json
    mockWhisperBin = path.join(tmpDir, 'mock-whisper-cli.mjs');
    const whisperScript = `#!/usr/bin/env node
import fs from 'node:fs';

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  process.stdout.write('usage: whisper-cli [options]\\n');
  process.exit(0);
}

let outPrefix = '';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-of' && argv[i + 1]) {
    outPrefix = argv[i + 1];
    break;
  }
}

if (outPrefix) {
  const jsonPath = outPrefix + '.json';
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      transcription: [
        {
          offsets: { from: 1000, to: 4500 },
          text: 'Hello world from supervised MCP whisper.',
          confidence: 0.99,
          words: [
            { offsets: { from: 1000, to: 2000 }, word: 'Hello', confidence: 0.99 },
            { offsets: { from: 2100, to: 3000 }, word: 'world', confidence: 0.99 },
          ],
        },
      ],
    })
  );
}
process.exit(0);
`;
    writeFileSync(mockWhisperBin, whisperScript);
    chmodSync(mockWhisperBin, 0o755);

    // Create a slow mock whisper-cli that stays alive (to test cancel / killAll cleanup)
    mockSlowWhisperBin = path.join(tmpDir, 'mock-slow-whisper.mjs');
    const slowScript = `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  process.stdout.write('usage: whisper-cli [options]\\n');
  process.exit(0);
}

// Keep process alive until killed
setInterval(() => {}, 1000);
`;
    writeFileSync(mockSlowWhisperBin, slowScript);
    chmodSync(mockSlowWhisperBin, 0o755);
  });

  after(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('parses whisper.cpp JSON output accurately into TranscriptSegment format', () => {
    const rawJson = {
      transcription: [
        {
          timestamps: { from: '00:00:01,250', to: '00:00:04,750' },
          text: 'Supervised transcription in action',
          confidence: 0.95,
          words: [
            { timestamps: { from: '00:00:01,250', to: '00:00:02,000' }, word: 'Supervised' },
            { timestamps: { from: '00:00:02,100', to: '00:00:03,000' }, word: 'transcription' },
          ],
        },
      ],
    };

    const segments = parseWhisperCppJson(rawJson, 'test-mtg-1');
    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.meeting_id, 'test-mtg-1');
    assert.equal(segments[0]?.start_ms, 1250);
    assert.equal(segments[0]?.end_ms, 4750);
    assert.equal(segments[0]?.text, 'Supervised transcription in action');
    assert.equal(segments[0]?.words?.length, 2);
    assert.equal(segments[0]?.words?.[0]?.word, 'Supervised');
    assert.equal(segments[0]?.words?.[0]?.start_ms, 1250);
  });

  it('exposes transcribe, transcribe_status, and transcribe_cancel tools via MCP protocol', async () => {
    const supervisor = new WhisperSupervisor();
    const server = createMeetingsMcpServer(supervisor);

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const toolsRes = await client.listTools();
    const toolNames = toolsRes.tools.map((t) => t.name);

    assert.ok(toolNames.includes('transcribe'), 'MCP exposes transcribe tool');
    assert.ok(toolNames.includes('transcribe_status'), 'MCP exposes transcribe_status tool');
    assert.ok(toolNames.includes('transcribe_cancel'), 'MCP exposes transcribe_cancel tool');

    await client.close();
    await server.close();
  });

  it('successfully transcribes an audio file via MCP transcribe tool', async () => {
    const meetingId = crypto.randomUUID();
    const mediaDir = path.join(tmpDir, 'media', meetingId);
    await fs.mkdir(mediaDir, { recursive: true });
    const audioPath = path.join(mediaDir, 'audio.wav');
    await fs.writeFile(audioPath, 'RIFFdummywavecontent1234567890');

    const supervisor = new WhisperSupervisor();
    const server = createMeetingsMcpServer(supervisor);

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const toolResult = await client.callTool({
      name: 'transcribe',
      arguments: {
        meeting_id: meetingId,
        audio_path: audioPath,
        output_dir: path.join(tmpDir, 'media'),
        whisper_bin: mockWhisperBin,
        model_dir: mockModelDir,
      },
    });

    assert.equal(toolResult.isError, false);
    const content = toolResult.content as Array<{ text?: string }>;
    const parsed = JSON.parse(content[0]?.text ?? '{}');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.meeting_id, meetingId);
    assert.equal(parsed.segment_count, 1);
    assert.equal(parsed.segments[0].text, 'Hello world from supervised MCP whisper.');

    // Verify re-use of existing transcript
    const reuseResult = await client.callTool({
      name: 'transcribe',
      arguments: {
        meeting_id: meetingId,
        audio_path: audioPath,
        output_dir: path.join(tmpDir, 'media'),
        whisper_bin: mockWhisperBin,
        model_dir: mockModelDir,
      },
    });

    const reuseContent = reuseResult.content as Array<{ text?: string }>;
    const reuseParsed = JSON.parse(reuseContent[0]?.text ?? '{}');
    assert.equal(reuseParsed.ok, true);
    assert.equal(reuseParsed.reused_existing_transcript, true);

    await client.close();
    await server.close();
  });

  it('guarantees child process termination on cancel, abort, and supervisor killAll', async () => {
    const meetingId = crypto.randomUUID();
    const mediaDir = path.join(tmpDir, 'media', meetingId);
    await fs.mkdir(mediaDir, { recursive: true });
    const audioPath = path.join(mediaDir, 'audio.wav');
    await fs.writeFile(audioPath, 'RIFFdummywavecontent1234567890');

    const supervisor = new WhisperSupervisor();

    let spawnedPid: number | null = null;
    const transcribePromise = supervisor.transcribe({
      meetingId,
      audioPath,
      outputDir: path.join(tmpDir, 'media'),
      whisperBinaryPath: mockSlowWhisperBin,
      modelDir: mockModelDir,
      onSpawn: (pid) => {
        spawnedPid = pid;
      },
    });

    // Wait until process is spawned
    const deadline = Date.now() + 5000;
    while (!spawnedPid && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(spawnedPid, 'Child whisper process was spawned');
    const pid = spawnedPid!;
    assert.equal(isProcessAlive(pid), true, 'Child process is initially alive');

    const status = supervisor.getStatus(meetingId);
    assert.equal(status.active, true);
    assert.equal(status.pid, pid);

    // Cancel transcription
    const cancelled = await supervisor.cancel(meetingId);
    assert.equal(cancelled, true);

    // Wait for process death
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(isProcessAlive(pid), false, 'Child whisper process was killed cleanly on cancel');

    // Await the transcribe promise which should finish/resolve
    const res = await transcribePromise;
    assert.equal(res.ok, false);

    // Now test killAll() on active jobs
    const meetingId2 = crypto.randomUUID();
    const mediaDir2 = path.join(tmpDir, 'media', meetingId2);
    await fs.mkdir(mediaDir2, { recursive: true });
    const audioPath2 = path.join(mediaDir2, 'audio.wav');
    await fs.writeFile(audioPath2, 'RIFFdummywavecontent1234567890');

    let spawnedPid2: number | null = null;
    void supervisor.transcribe({
      meetingId: meetingId2,
      audioPath: audioPath2,
      outputDir: path.join(tmpDir, 'media'),
      whisperBinaryPath: mockSlowWhisperBin,
      modelDir: mockModelDir,
      onSpawn: (pid) => {
        spawnedPid2 = pid;
      },
    });

    const deadline2 = Date.now() + 5000;
    while (!spawnedPid2 && Date.now() < deadline2) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(spawnedPid2, 'Second child process was spawned');
    const pid2 = spawnedPid2!;
    assert.equal(isProcessAlive(pid2), true);

    // Trigger killAll (simulating MCP server shutdown / dropped process)
    supervisor.killAll();

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(isProcessAlive(pid2), false, 'Child process killed immediately by supervisor.killAll()');
  });
});
