import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { parseArgs, parseFfprobeJson, runCli } from './cli.js';
import { writeSession, writeWhisperPid, readWhisperPid, isProcessAlive } from './session.js';
import { ensureMeetingMediaDir, getMeetingMediaFilePaths } from '@ikenga/meetings-contract/storage';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ikenga-cli-test-'));
}

async function captureCliOutput(argv: string[]): Promise<{ code: number; json: any }> {
  let output = '';
  const originalWrite = process.stdout.write;
  try {
    process.stdout.write = ((chunk: any) => {
      output += chunk.toString();
      return true;
    }) as any;
    const code = await runCli(argv);
    const json = JSON.parse(output.trim());
    return { code, json };
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe('CLI arg parsing', () => {
  it('reads a command with no flags', () => {
    assert.deepEqual(parseArgs(['preflight']), { command: 'preflight', flags: {} });
  });

  it('reads value flags', () => {
    const { command, flags } = parseArgs(['start', '--meeting-id', 'abc-123']);
    assert.equal(command, 'start');
    assert.equal(flags['meeting-id'], 'abc-123');
  });

  it('reads several flags together', () => {
    const { flags } = parseArgs([
      'transcribe',
      '--meeting-id', 'm1',
      '--model', 'base.en',
      '--language', 'en',
    ]);
    assert.equal(flags['meeting-id'], 'm1');
    assert.equal(flags.model, 'base.en');
    assert.equal(flags.language, 'en');
  });

  it('treats a valueless trailing flag as a boolean', () => {
    const { flags } = parseArgs(['status', '--verbose']);
    assert.equal(flags.verbose, 'true');
  });

  it('treats a flag followed by another flag as a boolean', () => {
    const { flags } = parseArgs(['status', '--verbose', '--meeting-id', 'm1']);
    assert.equal(flags.verbose, 'true');
    assert.equal(flags['meeting-id'], 'm1');
  });

  it('defaults to help when argv is empty', () => {
    assert.equal(parseArgs([]).command, 'help');
  });

  it('keeps a path value containing dashes intact', () => {
    const { flags } = parseArgs(['stop', '--output-dir', '/home/u/.ikenga/media-2']);
    assert.equal(flags['output-dir'], '/home/u/.ikenga/media-2');
  });
});

describe('ffprobe JSON parser', () => {
  it('parses valid ffprobe JSON with stream and format info', () => {
    const sampleFfprobe = JSON.stringify({
      streams: [
        {
          codec_name: 'pcm_s16le',
          sample_rate: '16000',
          channels: 1,
        },
      ],
      format: {
        duration: '203.699000',
      },
    });

    const facts = parseFfprobeJson(sampleFfprobe);
    assert.equal(facts.codec, 'pcm_s16le');
    assert.equal(facts.sample_rate, 16000);
    assert.equal(facts.channels, 1);
    assert.equal(facts.duration_seconds, 204);
  });

  it('returns nulls on invalid or empty JSON without throwing', () => {
    const facts = parseFfprobeJson('not json');
    assert.deepEqual(facts, {
      duration_seconds: null,
      sample_rate: null,
      channels: null,
      codec: null,
    });
  });

  it('handles missing streams or format objects cleanly', () => {
    const facts = parseFfprobeJson('{}');
    assert.deepEqual(facts, {
      duration_seconds: null,
      sample_rate: null,
      channels: null,
      codec: null,
    });
  });
});

describe('CLI info subcommand', () => {
  it('reports clean error on a completely unknown meeting id', async () => {
    const baseDir = await tmpDir();
    const { code, json } = await captureCliOutput([
      'info',
      '--meeting-id', 'unknown-meeting-123',
      '--output-dir', baseDir,
    ]);

    assert.equal(code, 1);
    assert.equal(json.ok, false);
    assert.ok(json.error.includes('meeting media directory not found'));
  });

  it('reports info on a meeting with audio and transcript', async () => {
    const baseDir = await tmpDir();
    const meetingId = 'm-full-take';
    const mediaDir = await ensureMeetingMediaDir(meetingId, baseDir);
    const paths = getMeetingMediaFilePaths(meetingId, baseDir);

    await fs.writeFile(paths.audioPath, 'fake-wav-data', 'utf8');
    await fs.writeFile(paths.audioCompressedPath, 'fake-m4a-data', 'utf8');

    const sampleTranscript = {
      transcription: [
        {
          offsets: { from: 1000, to: 2000 },
          text: 'Hello world',
        },
      ],
    };
    const transcriptPath = paths.audioPath.replace(/\.wav$/i, '') + '.transcript.json';
    await fs.writeFile(transcriptPath, JSON.stringify(sampleTranscript), 'utf8');

    const { code, json } = await captureCliOutput([
      'info',
      '--meeting-id', meetingId,
      '--output-dir', baseDir,
    ]);

    assert.equal(code, 0);
    assert.equal(json.ok, true);
    assert.equal(json.meeting_id, meetingId);
    assert.equal(json.media_dir, mediaDir);
    assert.equal(json.audio.exists, true);
    assert.equal(json.audio.path, paths.audioPath);
    assert.equal(json.audio.bytes, Buffer.byteLength('fake-wav-data'));
    assert.equal(json.compressed.exists, true);
    assert.equal(json.compressed.path, paths.audioCompressedPath);
    assert.equal(json.compressed.bytes, Buffer.byteLength('fake-m4a-data'));
    assert.equal(json.transcript.exists, true);
    assert.equal(json.transcript.segment_count, 1);
    assert.ok(typeof json.transcript.generated_at === 'string');
    assert.equal(json.recording.active, false);
    assert.equal(json.recording.pid, null);
    assert.equal(json.recording.started_at, null);
    assert.equal(json.recording.elapsed_seconds, 0);
    assert.equal(typeof json.engine.model_name, 'string');
  });

  it('reports info on a meeting with audio but no transcript without throwing', async () => {
    const baseDir = await tmpDir();
    const meetingId = 'm-no-transcript';
    await ensureMeetingMediaDir(meetingId, baseDir);
    const paths = getMeetingMediaFilePaths(meetingId, baseDir);

    await fs.writeFile(paths.audioPath, 'fake-wav-data', 'utf8');

    const { code, json } = await captureCliOutput([
      'info',
      '--meeting-id', meetingId,
      '--output-dir', baseDir,
    ]);

    assert.equal(code, 0);
    assert.equal(json.ok, true);
    assert.equal(json.meeting_id, meetingId);
    assert.equal(json.audio.exists, true);
    assert.equal(json.compressed.exists, false);
    assert.equal(json.transcript.exists, false);
    assert.equal(json.transcript.segment_count, null);
    assert.equal(json.transcript.generated_at, null);
  });

  it('reports mid-recording meeting session state correctly', async () => {
    const baseDir = await tmpDir();
    const meetingId = 'm-recording';
    const mediaDir = await ensureMeetingMediaDir(meetingId, baseDir);
    const paths = getMeetingMediaFilePaths(meetingId, baseDir);

    const startTime = new Date().toISOString();
    await writeSession(mediaDir, {
      meetingId,
      ffmpegPid: process.pid,
      audioPath: paths.audioPath,
      logPath: path.join(mediaDir, 'ffmpeg.log'),
      startedAt: startTime,
    });

    const { code, json } = await captureCliOutput([
      'info',
      '--meeting-id', meetingId,
      '--output-dir', baseDir,
    ]);

    assert.equal(code, 0);
    assert.equal(json.ok, true);
    assert.equal(json.recording.active, true);
    assert.equal(json.recording.pid, process.pid);
    assert.equal(json.recording.started_at, startTime);
  });
});

describe('transcribe pid guard', () => {
  it('blocks a second transcription when a live whisper pid exists', async () => {
    const baseDir = await tmpDir();
    const meetingId = 'm-guard-live';
    const mediaDir = await ensureMeetingMediaDir(meetingId, baseDir);
    const paths = getMeetingMediaFilePaths(meetingId, baseDir);

    await fs.writeFile(paths.audioPath, 'fake-audio-content', 'utf8');
    // Write current process pid as the "live" whisper process
    await writeWhisperPid(mediaDir, process.pid);

    const { code, json } = await captureCliOutput([
      'transcribe',
      '--meeting-id', meetingId,
      '--output-dir', baseDir,
    ]);

    assert.equal(code, 0);
    assert.equal(json.ok, false);
    assert.equal(json.already_running, true);
    assert.equal(json.pid, process.pid);
    assert.ok(json.error.includes(`a transcription is already running for this meeting (pid ${process.pid})`));
  });

  it('clears stale dead pid and does not block second run', async () => {
    const baseDir = await tmpDir();
    const meetingId = 'm-guard-dead';
    const mediaDir = await ensureMeetingMediaDir(meetingId, baseDir);
    const paths = getMeetingMediaFilePaths(meetingId, baseDir);

    await fs.writeFile(paths.audioPath, 'fake-audio-content', 'utf8');

    // Spawn and wait for child process to exit so we have a known dead PID
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = child.pid!;
    await new Promise((r) => child.on('exit', r));

    await writeWhisperPid(mediaDir, deadPid);

    // Provide a valid existing transcript so cmdTranscribe can adopt it cleanly
    const transcriptPath = paths.audioPath.replace(/\.wav$/i, '') + '.transcript.json';
    const sampleTranscript = { transcription: [{ text: 'adopted' }] };
    await fs.writeFile(transcriptPath, JSON.stringify(sampleTranscript), 'utf8');

    const { code, json } = await captureCliOutput([
      'transcribe',
      '--meeting-id', meetingId,
      '--output-dir', baseDir,
    ]);

    assert.equal(code, 0);
    assert.equal(json.ok, true);
    assert.equal(json.reused_existing_transcript, true);
    // Stale PID file should have been cleared
    assert.equal(await readWhisperPid(mediaDir), null);
  });

  it('--force kills live whisper process and overrides the guard', async () => {
    const baseDir = await tmpDir();
    const meetingId = 'm-guard-force';
    const mediaDir = await ensureMeetingMediaDir(meetingId, baseDir);
    const paths = getMeetingMediaFilePaths(meetingId, baseDir);

    await fs.writeFile(paths.audioPath, 'fake-audio-content', 'utf8');

    // Spawn a persistent child process
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const liveChildPid = child.pid!;

    assert.equal(isProcessAlive(liveChildPid), true);
    await writeWhisperPid(mediaDir, liveChildPid);

    const { json } = await captureCliOutput([
      'transcribe',
      '--meeting-id', meetingId,
      '--output-dir', baseDir,
      '--force',
    ]);

    // The subject of this test is the GUARD, not the transcription.
    //
    // `--force` deliberately bypasses transcript reuse as well, so what happens
    // after the guard is cleared depends on whether whisper.cpp and a model are
    // installed on the machine running the test. Asserting `code === 0` made
    // this pass on a developer box with whisper installed and fail on CI, which
    // has neither — an environment-dependent test that turned the build red for
    // everyone except its author.
    //
    // So assert only what `--force` actually promises: the stale process is
    // killed, and the run is NOT short-circuited by the already-running refusal.
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(isProcessAlive(liveChildPid), false, '--force must kill the stale whisper');
    assert.notEqual(json.already_running, true, '--force must not be refused by the guard');
  });
});
