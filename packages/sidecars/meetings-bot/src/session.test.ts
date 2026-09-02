import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  readSession,
  writeSession,
  clearSession,
  sessionFilePath,
  readWhisperPid,
  writeWhisperPid,
  clearWhisperPid,
  whisperPidFilePath,
  isProcessAlive,
  elapsedSecondsSince,
  RecordingSession,
} from './session.js';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ikenga-meetings-session-'));
}

const sample = (over: Partial<RecordingSession> = {}): RecordingSession => ({
  meetingId: 'm-1',
  ffmpegPid: 4242,
  audioPath: '/tmp/m-1/audio.wav',
  logPath: '/tmp/m-1/ffmpeg.log',
  startedAt: new Date().toISOString(),
  ...over,
});

describe('recording session state', () => {
  it('round-trips a session through disk', async () => {
    const dir = await tmpDir();
    const session = sample();
    await writeSession(dir, session);
    assert.deepEqual(await readSession(dir), session);
  });

  it('reports no session before one is written', async () => {
    assert.equal(await readSession(await tmpDir()), null);
  });

  it('treats a corrupt state file as no session rather than throwing', async () => {
    // A half-written state file must not crash the stop path — the user still
    // needs the recorder to come back to idle so they can start again.
    const dir = await tmpDir();
    await fs.writeFile(sessionFilePath(dir), '{ this is not json', 'utf8');
    assert.equal(await readSession(dir), null);
  });

  it('clears a session', async () => {
    const dir = await tmpDir();
    await writeSession(dir, sample());
    await clearSession(dir);
    assert.equal(await readSession(dir), null);
  });

  it('clearing a non-existent session is a no-op, not an error', async () => {
    await clearSession(await tmpDir());
  });
});

describe('whisper pid management', () => {
  it('round-trips a whisper pid through disk', async () => {
    const dir = await tmpDir();
    await writeWhisperPid(dir, 12345);
    assert.equal(await readWhisperPid(dir), 12345);
  });

  it('reports null when no whisper pid file exists', async () => {
    assert.equal(await readWhisperPid(await tmpDir()), null);
  });

  it('treats corrupt or non-numeric pid file as null rather than throwing', async () => {
    const dir = await tmpDir();
    await fs.writeFile(whisperPidFilePath(dir), 'invalid-pid', 'utf8');
    assert.equal(await readWhisperPid(dir), null);
  });

  it('clears a whisper pid', async () => {
    const dir = await tmpDir();
    await writeWhisperPid(dir, 9876);
    await clearWhisperPid(dir);
    assert.equal(await readWhisperPid(dir), null);
  });

  it('clearing a non-existent whisper pid file is a no-op', async () => {
    await clearWhisperPid(await tmpDir());
  });
});

describe('isProcessAlive', () => {
  it('sees a live process', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('sees a reaped process as dead', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    const pid = child.pid!;
    await new Promise((r) => child.on('exit', r));
    assert.equal(isProcessAlive(pid), false);
  });

  it('reports pid 1 as alive (EPERM must not read as dead)', () => {
    // pid 1 exists but is not ours to signal, so kill(pid, 0) raises EPERM.
    // Misreading that as "dead" would make stop() skip the SIGINT and leave a
    // recorder running forever, so this case is pinned explicitly.
    assert.equal(isProcessAlive(1), true);
  });
});

describe('elapsedSecondsSince', () => {
  it('measures forward from the start timestamp', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    const elapsed = elapsedSecondsSince(tenSecondsAgo);
    assert.ok(elapsed >= 9 && elapsed <= 11, `expected ~10, got ${elapsed}`);
  });

  it('never returns negative for a clock-skewed future timestamp', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(elapsedSecondsSince(future), 0);
  });

  it('returns 0 for an unparseable timestamp', () => {
    assert.equal(elapsedSecondsSince('not-a-date'), 0);
  });
});
