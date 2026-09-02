import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { WhisperSupervisor } from './whisper.js';

/**
 * The test WP-17 exists to pass.
 *
 * Everything else about the supervised server is scaffolding; the single claim
 * that justifies it is "an abandoned transcription does not leave whisper
 * burning cores forever". The parked draft of this work asserted that claim in
 * prose and in signal handlers that cannot fire — the shell kills a supervised
 * child with SIGKILL — and shipped no test for it at all.
 *
 * So these tests spawn a REAL long-running process, register it exactly as a
 * whisper job registers itself, abandon it, and assert it is dead afterwards.
 * No mocks: a mocked orphan proves nothing, which is the whole lesson of this
 * plan.
 *
 * Deliberately requires neither whisper.cpp nor ffmpeg, so it passes on CI.
 */

/** A stand-in for whisper: alive until something kills it. */
function spawnStandInWhisper(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  return {
    pid: child.pid!,
    kill: () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function settle(ms = 150): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function tmpMediaRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ikenga-orphan-'));
}

/** Register a pid the way a real transcription run does. */
async function seedOrphan(mediaRoot: string, meetingId: string, pid: number): Promise<string> {
  const dir = path.join(mediaRoot, meetingId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'whisper.pid'), String(pid), 'utf8');
  return dir;
}

describe('WP-17 · orphaned whisper is bounded by the next server start', () => {
  it('reaps a live whisper left behind by a previous run', async () => {
    const root = await tmpMediaRoot();
    const orphan = spawnStandInWhisper();
    await seedOrphan(root, 'm-orphaned', orphan.pid);

    assert.equal(isAlive(orphan.pid), true, 'precondition: the orphan is running');

    const reaped = await new WhisperSupervisor().sweepOrphans(root);

    await settle();
    assert.equal(reaped, 1, 'sweep should report one reap');
    assert.equal(isAlive(orphan.pid), false, 'the orphan must be dead after the sweep');

    orphan.kill();
  });

  it('clears the pid file so the guard does not block the next run forever', async () => {
    // The pid guard refuses a second transcription while a pid file names a
    // live process. If the sweep killed the process but left the file, a stale
    // file naming a recycled pid could wedge transcription indefinitely.
    const root = await tmpMediaRoot();
    const orphan = spawnStandInWhisper();
    const dir = await seedOrphan(root, 'm-stale-file', orphan.pid);

    await new WhisperSupervisor().sweepOrphans(root);
    await settle();

    const exists = await fs
      .access(path.join(dir, 'whisper.pid'))
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false, 'pid file must be cleared, not just the process killed');

    orphan.kill();
  });

  it('is a no-op for a pid that is already dead', async () => {
    const root = await tmpMediaRoot();
    const dead = spawnStandInWhisper();
    dead.kill();
    await settle();
    assert.equal(isAlive(dead.pid), false, 'precondition: pid is dead');

    await seedOrphan(root, 'm-already-dead', dead.pid);
    const reaped = await new WhisperSupervisor().sweepOrphans(root);

    assert.equal(reaped, 0, 'a dead pid is not a reap');
  });

  it('never kills a job the running supervisor owns', async () => {
    // The sweep runs at boot, but a long-lived server can also be asked to
    // sweep later. It must not shoot its own live transcription in the head.
    const root = await tmpMediaRoot();
    const mine = spawnStandInWhisper();
    const dir = await seedOrphan(root, 'm-mine', mine.pid);

    const supervisor = new WhisperSupervisor();
    // Register it as active, mirroring what transcribe() does.
    (supervisor as unknown as { activeJobs: Map<string, unknown> }).activeJobs.set('m-mine', {
      pid: mine.pid,
      mediaDir: dir,
      child: { kill: () => {} },
    });

    const reaped = await supervisor.sweepOrphans(root);
    await settle();

    assert.equal(reaped, 0, 'an owned job is not an orphan');
    assert.equal(isAlive(mine.pid), true, 'the supervisor must not kill its own live job');

    mine.kill();
  });

  it('survives a media root that does not exist', async () => {
    const reaped = await new WhisperSupervisor().sweepOrphans(
      path.join(os.tmpdir(), 'ikenga-does-not-exist-' + Date.now())
    );
    assert.equal(reaped, 0);
  });
});
