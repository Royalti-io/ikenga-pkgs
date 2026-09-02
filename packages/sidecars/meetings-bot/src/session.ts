// Recording session state that outlives the process that started it.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// The shell reaches a pkg's sidecar through `host.pkgSidecarCall` →
// `pkg_sidecar_call` (shell/src-tauri/src/commands/pkg_sidecar.rs), which is
// strictly ONE-SHOT: it spawns the binary, feeds it stdin, collects stdout,
// and drops the child — with `kill_on_drop(true)`. `manifest.sidecars[]`
// entries are not supervised; only a `manifest.mcp[]` entry with
// `lifecycle: "long-lived"` gets a persistent process.
//
// A recording, however, spans two user gestures minutes apart (Start … Stop).
// It therefore CANNOT live inside the sidecar process — that process is gone
// microseconds after `start` returns. The recording has to outlive it.
//
// So the sidecar detaches ffmpeg into its own session (`setsid`) and writes
// the handle to disk here. A later, entirely separate `stop` invocation reads
// this file back and signals that pid. The state file is the only thing
// linking the two calls.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Written into the meeting's own media directory, so a session is discovered
 *  by meeting id alone and two concurrent meetings cannot collide. */
export const SESSION_FILE = 'session.json';

export interface RecordingSession {
  meetingId: string;
  /** pid of the DETACHED ffmpeg process, not of the sidecar that spawned it. */
  ffmpegPid: number;
  audioPath: string;
  logPath: string;
  /** ISO-8601. Elapsed time is derived from this rather than stored, so a
   *  status call is correct no matter how long ago the recorder started. */
  startedAt: string;
  outputDir?: string;
}

export function sessionFilePath(mediaDir: string): string {
  return path.join(mediaDir, SESSION_FILE);
}

export async function writeSession(mediaDir: string, session: RecordingSession): Promise<void> {
  await fs.writeFile(sessionFilePath(mediaDir), JSON.stringify(session, null, 2), 'utf8');
}

export async function readSession(mediaDir: string): Promise<RecordingSession | null> {
  const file = sessionFilePath(mediaDir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as RecordingSession;
  } catch {
    // A truncated/corrupt state file means the session is unrecoverable, which
    // is the same observable condition as "no session" — the caller's stop path
    // then reports idle rather than throwing at the user.
    return null;
  }
}

export async function clearSession(mediaDir: string): Promise<void> {
  await fs.rm(sessionFilePath(mediaDir), { force: true });
}

export const WHISPER_PID_FILE = 'whisper.pid';

export function whisperPidFilePath(mediaDir: string): string {
  return path.join(mediaDir, WHISPER_PID_FILE);
}

export async function writeWhisperPid(mediaDir: string, pid: number): Promise<void> {
  await fs.writeFile(whisperPidFilePath(mediaDir), String(pid), 'utf8');
}

export async function readWhisperPid(mediaDir: string): Promise<number | null> {
  const file = whisperPidFilePath(mediaDir);
  if (!existsSync(file)) return null;
  try {
    const raw = (await fs.readFile(file, 'utf8')).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function clearWhisperPid(mediaDir: string): Promise<void> {
  await fs.rm(whisperPidFilePath(mediaDir), { force: true });
}

/**
 * Whether a pid is still alive.
 *
 * `kill(pid, 0)` performs the permission + existence check without delivering
 * a signal. EPERM means the process EXISTS but belongs to another user, so it
 * must be read as alive — treating it as dead is the misread that makes a
 * recorder think it stopped while ffmpeg keeps writing. Only ESRCH is dead.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function elapsedSecondsSince(startedAt: string): number {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}
