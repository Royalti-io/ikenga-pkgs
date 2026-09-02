// One-shot CLI surface for the meetings sidecar.
//
// This is what `host.pkgSidecarCall({ sidecar: 'pa-meetings-bot', args: [...] })`
// actually invokes. Every subcommand runs to completion, prints ONE JSON object
// on stdout, and exits — matching `pkg_sidecar_call`'s spawn/collect/drop
// lifecycle (see session.ts for why the recording itself must be detached).
//
// The long-lived stdio JSON-RPC server in sidecar.ts is kept for direct/manual
// use and for the existing unit tests, but the shell never drives it: nothing
// an iframe can call produces a supervised process for a `sidecars[]` entry.
//
// Output contract: stdout is JSON and nothing else. Diagnostics go to stderr,
// because `pkg_sidecar_call` parses stdout as JSON and any stray log line
// silently degrades the result to a raw-text wrapper.
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ensureMeetingMediaDir,
  getMeetingMediaFilePaths,
  resolveMeetingMediaDir,
} from '@ikenga/meetings-contract/storage';

import { buildFfmpegArgs, FfmpegGraphConfig } from './capture/ffmpeg-graph.js';
import { runCapturePreflight } from './capture/preflight.js';
import { LocalWhisperEngine, parseWhisperCppJson } from './whisper/engine.js';
import { resolveWhisperBinary } from './whisper/binary.js';
import {
  DEFAULT_WHISPER_MODEL,
  WhisperModelName,
  resolveModelPath,
  isModelDownloaded,
} from './whisper/models.js';
import {
  RecordingSession,
  readSession,
  writeSession,
  clearSession,
  isProcessAlive,
  elapsedSecondsSince,
} from './session.js';

const execFileAsync = promisify(execFile);

// ─── arg parsing ───────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = 'true';
    }
  }
  return { command, flags };
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) throw new Error(`missing required flag --${name}`);
  return value;
}

// ─── commands ──────────────────────────────────────────────────────────────

async function cmdPreflight(flags: Record<string, string>): Promise<unknown> {
  const mode = flags.mode === 'bot' ? 'bot' : 'local_recording';
  const capture = await runCapturePreflight({ mode });
  const whisper = await resolveWhisperBinary(flags['whisper-bin']);
  const model = (flags.model as WhisperModelName) ?? DEFAULT_WHISPER_MODEL;
  const modelPath = resolveModelPath(model, flags['model-dir']);
  const modelReady = await isModelDownloaded(model, flags['model-dir']);

  // Capture and transcription are reported separately and the overall `ok`
  // requires both: a box that can record but not transcribe produces a silent
  // half-failure at the end of a real meeting, which is the worst time to find
  // out. Better to refuse to arm than to lose the only take.
  return {
    ok: capture.ok && whisper.available && modelReady,
    capture,
    whisper: {
      available: whisper.available,
      path: whisper.path,
      error: whisper.error,
    },
    model: {
      name: model,
      path: modelPath,
      downloaded: modelReady,
    },
  };
}

async function cmdStart(flags: Record<string, string>): Promise<unknown> {
  const meetingId = requireFlag(flags, 'meeting-id');
  const outputDir = flags['output-dir'];

  const preflight = await runCapturePreflight({ mode: 'local_recording' });
  if (!preflight.ok) {
    throw new Error(`preflight failed: ${preflight.errors.join('; ')}`);
  }

  const mediaDir = await ensureMeetingMediaDir(meetingId, outputDir);

  // Refuse to double-start. Two ffmpeg processes writing the same audio.wav
  // corrupts both takes, and the second `start` would orphan the first pid by
  // overwriting the state file — an unkillable recorder holding the mic open.
  const existing = await readSession(mediaDir);
  if (existing && isProcessAlive(existing.ffmpegPid)) {
    throw new Error(
      `a recording is already running for meeting ${meetingId} (pid ${existing.ffmpegPid})`
    );
  }

  const paths = getMeetingMediaFilePaths(meetingId, outputDir);
  const logPath = path.join(mediaDir, 'ffmpeg.log');

  const graphConfig: FfmpegGraphConfig = {
    audioInput: { type: 'pulse' },
    outputAudioPath: paths.audioPath,
    // Written during capture rather than transcoded afterwards, so playback is
    // available the moment a recording stops.
    outputCompressedPath: paths.audioCompressedPath,
  };
  const args = buildFfmpegArgs(graphConfig);

  // Detach: `setsid` + ignored stdio + unref. All three are load-bearing.
  // `pkg_sidecar_call` sets `kill_on_drop(true)`, so without `detached` the
  // recorder dies the instant `start` returns; without redirecting stdio the
  // child keeps our pipes open and the shell's collect step never completes;
  // without `unref` this process cannot exit while the child lives.
  const logFd = openSync(logPath, 'a');
  const child = spawn(flags.ffmpeg ?? 'ffmpeg', args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  if (typeof child.pid !== 'number') {
    throw new Error('failed to spawn ffmpeg (no pid)');
  }

  const session: RecordingSession = {
    meetingId,
    ffmpegPid: child.pid,
    audioPath: paths.audioPath,
    logPath,
    startedAt: new Date().toISOString(),
    outputDir,
  };
  await writeSession(mediaDir, session);

  // Give ffmpeg a moment to fail loudly (bad device, permissions) so the UI
  // reports "could not start" now rather than showing a running timer over a
  // dead recorder that produces nothing.
  await new Promise((r) => setTimeout(r, 700));
  if (!isProcessAlive(child.pid)) {
    await clearSession(mediaDir);
    const log = await fs.readFile(logPath, 'utf8').catch(() => '');
    const tail = log.trim().split('\n').slice(-6).join('\n');
    throw new Error(`ffmpeg exited immediately. Last output:\n${tail}`);
  }

  return {
    ok: true,
    meeting_id: meetingId,
    media_dir: mediaDir,
    audio_path: paths.audioPath,
    pid: child.pid,
    started_at: session.startedAt,
  };
}

async function cmdStatus(flags: Record<string, string>): Promise<unknown> {
  const meetingId = requireFlag(flags, 'meeting-id');
  const mediaDir = resolveMeetingMediaDir(meetingId, flags['output-dir']);
  const session = await readSession(mediaDir);

  if (!session || !isProcessAlive(session.ffmpegPid)) {
    return { meeting_id: meetingId, state: 'idle', elapsed_seconds: 0 };
  }
  return {
    meeting_id: meetingId,
    state: 'recording',
    elapsed_seconds: elapsedSecondsSince(session.startedAt),
    audio_path: session.audioPath,
    pid: session.ffmpegPid,
  };
}

async function probeDurationSeconds(audioPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  } catch {
    return null;
  }
}

async function cmdStop(flags: Record<string, string>): Promise<unknown> {
  const meetingId = requireFlag(flags, 'meeting-id');
  const mediaDir = resolveMeetingMediaDir(meetingId, flags['output-dir']);
  const session = await readSession(mediaDir);

  if (!session) {
    throw new Error(`no recording session found for meeting ${meetingId}`);
  }

  if (isProcessAlive(session.ffmpegPid)) {
    // SIGINT, never SIGKILL. ffmpeg traps SIGINT to flush buffers and rewrite
    // the RIFF/data chunk sizes in the WAV header; a killed ffmpeg leaves the
    // header claiming zero length and every player — and whisper — reads the
    // file as empty. The whole recording is lost on the wrong signal.
    process.kill(session.ffmpegPid, 'SIGINT');

    const deadline = Date.now() + 10_000;
    while (isProcessAlive(session.ffmpegPid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isProcessAlive(session.ffmpegPid)) {
      // Escalate only after a grace period; a truncated tail beats a wedged
      // process holding the audio device open against the next recording.
      process.kill(session.ffmpegPid, 'SIGKILL');
    }
  }

  await clearSession(mediaDir);

  const wallClock = elapsedSecondsSince(session.startedAt);
  // Prefer the real media duration: wall-clock overstates by the startup and
  // shutdown margins, which would desync every transcript timestamp in the
  // player against the audio it is supposed to follow.
  const duration = (await probeDurationSeconds(session.audioPath)) ?? wallClock;

  const stat = await fs.stat(session.audioPath).catch(() => null);

  return {
    ok: true,
    meeting_id: meetingId,
    duration_seconds: duration,
    audio_path: session.audioPath,
    bytes: stat?.size ?? 0,
  };
}

async function cmdTranscribe(flags: Record<string, string>): Promise<unknown> {
  const meetingId = requireFlag(flags, 'meeting-id');
  const paths = getMeetingMediaFilePaths(meetingId, flags['output-dir']);
  const audioPath = flags.audio ?? paths.audioPath;

  const stat = await fs.stat(audioPath).catch(() => null);
  if (!stat) throw new Error(`audio file not found: ${audioPath}`);
  if (stat.size === 0) throw new Error(`audio file is empty: ${audioPath}`);

  // ── Reuse a completed run before starting a new one ─────────────────────
  //
  // whisper.cpp is a GRANDCHILD of the shell: the host spawns this CLI, and
  // this CLI spawns whisper. When a call is abandoned (an MCP timeout, a pane
  // reload) the host kills the CLI, but the grandchild is not in that kill and
  // keeps running to completion — observed burning ~380% CPU for minutes after
  // its caller had given up, then writing a perfectly good transcript nobody
  // read. Rather than throw that work away and pay for it twice, a retry
  // adopts the finished JSON when it is newer than the audio it describes.
  const outJsonPath = audioPath.replace(/\.wav$/i, '') + '.transcript.json';
  if (flags.force !== 'true') {
    const jsonStat = await fs.stat(outJsonPath).catch(() => null);
    if (jsonStat && jsonStat.mtimeMs >= stat.mtimeMs) {
      const parsed = JSON.parse(await fs.readFile(outJsonPath, 'utf8'));
      const segments = parseWhisperCppJson(parsed, meetingId);
      return {
        ok: true,
        meeting_id: meetingId,
        audio_path: audioPath,
        segment_count: segments.length,
        segments,
        reused_existing_transcript: true,
      };
    }
  }

  const engine = new LocalWhisperEngine();
  const segments = await engine.transcribe({
    audioWavPath: audioPath,
    meetingId,
    model: (flags.model as WhisperModelName) ?? DEFAULT_WHISPER_MODEL,
    language: flags.language ?? 'en',
    whisperBinaryPath: flags['whisper-bin'],
    modelDir: flags['model-dir'],
  });

  return {
    ok: true,
    meeting_id: meetingId,
    audio_path: audioPath,
    segment_count: segments.length,
    segments,
  };
}


/**
 * Return a meeting's audio as base64 for playback in the iframe.
 *
 * The pane cannot load audio off disk: there is no file-read host verb, and an
 * <audio src="/home/..."> resolves against the pkg content server, not the
 * filesystem — which is why the player's controls did nothing at all. Bytes
 * over the bridge into a blob: URL is the same route com.ikenga.studio uses for
 * render previews.
 *
 * Prefers the compressed copy and transcodes one on demand when it is missing,
 * so recordings made before that existed still play without re-recording.
 */
async function cmdReadAudio(flags: Record<string, string>): Promise<unknown> {
  const meetingId = requireFlag(flags, 'meeting-id');
  const paths = getMeetingMediaFilePaths(meetingId, flags['output-dir']);

  let sourcePath = paths.audioCompressedPath;
  let mime = 'audio/mp4';

  if (!(await fs.stat(sourcePath).catch(() => null))) {
    const master = await fs.stat(paths.audioPath).catch(() => null);
    if (!master) throw new Error(`no audio found for meeting ${meetingId}`);
    try {
      await execFileAsync(flags.ffmpeg ?? 'ffmpeg', [
        '-y', '-i', paths.audioPath,
        '-vn', '-c:a', 'aac', '-b:a', '32k', '-ac', '1',
        paths.audioCompressedPath,
      ]);
    } catch {
      // Transcode failed (no AAC encoder, disk full). Fall back to the PCM
      // master: far larger over the bridge, but playable, and a big file beats
      // a dead play button.
      sourcePath = paths.audioPath;
      mime = 'audio/wav';
    }
  }

  const buf = await fs.readFile(sourcePath);
  return {
    ok: true,
    meeting_id: meetingId,
    mime,
    bytes: buf.length,
    base64: buf.toString('base64'),
  };
}

// ─── entrypoint ────────────────────────────────────────────────────────────

const COMMANDS: Record<string, (flags: Record<string, string>) => Promise<unknown>> = {
  preflight: cmdPreflight,
  start: cmdStart,
  status: cmdStatus,
  stop: cmdStop,
  transcribe: cmdTranscribe,
  'read-audio': cmdReadAudio,
};

export async function runCli(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);

  const handler = COMMANDS[command];
  if (!handler) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: `unknown command '${command}'`,
        commands: Object.keys(COMMANDS),
      }) + '\n'
    );
    return 2;
  }

  try {
    const result = await handler(flags);
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (err) {
    // Errors are reported as a JSON object on stdout with a non-zero exit, so
    // the iframe gets a structured reason it can show the user instead of the
    // shell's generic "sidecar failed".
    process.stdout.write(
      JSON.stringify({ ok: false, error: (err as Error).message ?? String(err) }) + '\n'
    );
    return 1;
  }
}
