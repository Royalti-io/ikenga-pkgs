import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { TranscriptSegment } from '@ikenga/meetings-contract';

const execFileAsync = promisify(execFile);

// ─── Media Storage Path Helpers ────────────────────────────────────────────

export const MEETING_MEDIA_FILES = {
  AUDIO: 'audio.wav',
  AUDIO_COMPRESSED: 'audio.m4a',
  VIDEO: 'video.mp4',
  METADATA: 'meta.json',
  TRANSCRIPT_RAW: 'transcript.raw.json',
} as const;

export function getDefaultMediaBaseDir(): string {
  return path.join(os.homedir(), '.ikenga', 'media');
}

export function resolveMeetingMediaDir(meetingId: string, customBaseDir?: string): string {
  const base = customBaseDir ?? getDefaultMediaBaseDir();
  return path.join(base, 'meetings', meetingId);
}

export interface MeetingMediaPaths {
  dir: string;
  videoPath: string;
  audioPath: string;
  audioCompressedPath: string;
  metaPath: string;
  transcriptRawPath: string;
}

export function getMeetingMediaFilePaths(
  meetingId: string,
  customBaseDir?: string
): MeetingMediaPaths {
  const dir = resolveMeetingMediaDir(meetingId, customBaseDir);
  return {
    dir,
    videoPath: path.join(dir, MEETING_MEDIA_FILES.VIDEO),
    audioPath: path.join(dir, MEETING_MEDIA_FILES.AUDIO),
    audioCompressedPath: path.join(dir, MEETING_MEDIA_FILES.AUDIO_COMPRESSED),
    metaPath: path.join(dir, MEETING_MEDIA_FILES.METADATA),
    transcriptRawPath: path.join(dir, MEETING_MEDIA_FILES.TRANSCRIPT_RAW),
  };
}

export async function ensureMeetingMediaDir(
  meetingId: string,
  customBaseDir?: string
): Promise<string> {
  const dir = resolveMeetingMediaDir(meetingId, customBaseDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ─── Whisper Models ─────────────────────────────────────────────────────────

export type WhisperModelName =
  | 'tiny.en'
  | 'base.en'
  | 'small.en'
  | 'medium.en'
  | 'large-v3-q5_0';

export interface WhisperModelInfo {
  name: WhisperModelName;
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
}

export const WHISPER_MODELS: Record<WhisperModelName, WhisperModelInfo> = {
  'tiny.en': {
    name: 'tiny.en',
    filename: 'ggml-tiny.en.bin',
    sizeBytes: 77691648,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  'base.en': {
    name: 'base.en',
    filename: 'ggml-base.en.bin',
    sizeBytes: 147964211,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  'small.en': {
    name: 'small.en',
    filename: 'ggml-small.en.bin',
    sizeBytes: 487847424,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
  'medium.en': {
    name: 'medium.en',
    filename: 'ggml-medium.en.bin',
    sizeBytes: 1533755456,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  },
  'large-v3-q5_0': {
    name: 'large-v3-q5_0',
    filename: 'ggml-large-v3-q5_0.bin',
    sizeBytes: 1083981824,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin',
  },
};

export const DEFAULT_WHISPER_MODEL: WhisperModelName = 'small.en';

export function getModelCacheDir(customDir?: string): string {
  if (customDir) return customDir;
  return path.join(os.homedir(), '.ikenga', 'models', 'whisper');
}

export function resolveModelPath(modelName: WhisperModelName, customDir?: string): string {
  const info = WHISPER_MODELS[modelName];
  if (!info) {
    throw new Error(`Unknown whisper model: ${modelName}`);
  }
  const dir = getModelCacheDir(customDir);
  return path.join(dir, info.filename);
}

export async function isModelDownloaded(
  modelName: WhisperModelName,
  customDir?: string
): Promise<boolean> {
  const filePath = resolveModelPath(modelName, customDir);
  return existsSync(filePath);
}

// ─── Binary Resolution ─────────────────────────────────────────────────────

export interface WhisperBinaryResolution {
  available: boolean;
  path?: string;
  source?: 'custom' | 'user_bin' | 'path';
  version?: string;
  error?: string;
}

export async function resolveWhisperBinary(
  customPath?: string
): Promise<WhisperBinaryResolution> {
  if (customPath) {
    return resolveSingleCandidate({ path: customPath, source: 'custom' });
  }

  const userBin = path.join(
    os.homedir(),
    '.ikenga',
    'bin',
    os.platform() === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  );
  const candidates: Array<{ path: string; source: 'custom' | 'user_bin' | 'path' }> = [
    { path: userBin, source: 'user_bin' },
  ];

  const binaryNames =
    os.platform() === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'whisper', 'main'];
  for (const name of binaryNames) {
    candidates.push({ path: name, source: 'path' });
  }

  for (const candidate of candidates) {
    const resolved = await resolveSingleCandidate(candidate);
    if (resolved.available) return resolved;
  }

  return {
    available: false,
    error:
      'whisper.cpp binary (whisper-cli) not found. Please install whisper-cli or place it in ~/.ikenga/bin/whisper-cli.',
  };
}

async function resolveSingleCandidate(candidate: {
  path: string;
  source: 'custom' | 'user_bin' | 'path';
}): Promise<WhisperBinaryResolution> {
  const notFound: WhisperBinaryResolution = {
    available: false,
    error:
      candidate.source === 'custom'
        ? `whisper.cpp binary (whisper-cli) not found at the configured path ${candidate.path}.`
        : 'whisper.cpp binary (whisper-cli) not found. Please install whisper-cli or place it in ~/.ikenga/bin/whisper-cli.',
  };

  if (candidate.source !== 'path' && !existsSync(candidate.path)) {
    return notFound;
  }

  try {
    const { stdout, stderr } = await execFileAsync(candidate.path, ['-h']);
    const output = stdout || stderr;
    if (output.includes('usage:') || output.includes('whisper') || output.includes('-m')) {
      return {
        available: true,
        path: candidate.path,
        source: candidate.source,
        version: 'whisper.cpp',
      };
    }
  } catch (err: any) {
    if (err?.stdout?.includes('usage:') || err?.stderr?.includes('usage:')) {
      return {
        available: true,
        path: candidate.path,
        source: candidate.source,
        version: 'whisper.cpp',
      };
    }
  }

  return notFound;
}

// ─── Timestamp & Output Parsing ────────────────────────────────────────────

function parseTimestampMs(timeStr: string): number {
  const normalized = timeStr.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0] ?? '0');
    const mins = parseFloat(parts[1] ?? '0');
    const secs = parseFloat(parts[2] ?? '0');
    return Math.round((hours * 3600 + mins * 60 + secs) * 1000);
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[1] ?? '0');
    const secs = parseFloat(parts[0] ?? '0');
    return Math.round((mins * 60 + secs) * 1000);
  }
  return Math.round(parseFloat(normalized) * 1000);
}

export function parseWhisperCppJson(
  jsonData: any,
  meetingId: string
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const rawSegments = jsonData.transcription || jsonData.segments || [];

  for (const seg of rawSegments) {
    const startMs =
      typeof seg.offsets?.from === 'number'
        ? seg.offsets.from
        : typeof seg.timestamps?.from === 'string'
          ? parseTimestampMs(seg.timestamps.from)
          : Math.round((seg.from ?? seg.start ?? 0) * 1000);

    const endMs =
      typeof seg.offsets?.to === 'number'
        ? seg.offsets.to
        : typeof seg.timestamps?.to === 'string'
          ? parseTimestampMs(seg.timestamps.to)
          : Math.round((seg.to ?? seg.end ?? 0) * 1000);

    const text = (seg.text ?? '').trim();
    if (!text) continue;

    const words: Array<{ word: string; start_ms: number; end_ms: number; confidence: number }> = [];
    if (Array.isArray(seg.words)) {
      for (const w of seg.words) {
        const wStart =
          typeof w.offsets?.from === 'number'
            ? w.offsets.from
            : typeof w.timestamps?.from === 'string'
              ? parseTimestampMs(w.timestamps.from)
              : Math.round((w.from ?? w.start ?? 0) * 1000);
        const wEnd =
          typeof w.offsets?.to === 'number'
            ? w.offsets.to
            : typeof w.timestamps?.to === 'string'
              ? parseTimestampMs(w.timestamps.to)
              : Math.round((w.to ?? w.end ?? 0) * 1000);

        words.push({
          word: (w.word ?? w.text ?? '').trim(),
          start_ms: Math.max(0, wStart),
          end_ms: Math.max(wStart, wEnd),
          confidence: w.confidence ?? 1.0,
        });
      }
    }

    segments.push({
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      speaker_source: 'dom_cue',
      start_ms: Math.max(0, startMs),
      end_ms: Math.max(startMs, endMs),
      text,
      confidence: seg.confidence ?? 1.0,
      words: words.length > 0 ? words : undefined,
    });
  }

  return segments;
}

// ─── PID file helpers ──────────────────────────────────────────────────────

const WHISPER_PID_FILE = 'whisper.pid';

async function writeWhisperPid(mediaDir: string, pid: number): Promise<void> {
  await fs.writeFile(path.join(mediaDir, WHISPER_PID_FILE), String(pid), 'utf8');
}

async function readWhisperPid(mediaDir: string): Promise<number | null> {
  const file = path.join(mediaDir, WHISPER_PID_FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = (await fs.readFile(file, 'utf8')).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function clearWhisperPid(mediaDir: string): Promise<void> {
  await fs.rm(path.join(mediaDir, WHISPER_PID_FILE), { force: true });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

// ─── Supervised Whisper Engine ─────────────────────────────────────────────

export interface TranscribeOptions {
  meetingId: string;
  audioPath?: string;
  outputDir?: string;
  model?: WhisperModelName;
  language?: string;
  whisperBinaryPath?: string;
  modelDir?: string;
  force?: boolean;
  onSpawn?: (pid: number) => void | Promise<void>;
  onProgress?: (text: string) => void;
}

export interface TranscribeSuccessResult {
  ok: true;
  meeting_id: string;
  audio_path: string;
  segment_count: number;
  segments: TranscriptSegment[];
  reused_existing_transcript?: boolean;
}

export interface TranscribeErrorResult {
  ok: false;
  meeting_id?: string;
  error: string;
  already_running?: boolean;
  pid?: number;
}

export type TranscribeResult = TranscribeSuccessResult | TranscribeErrorResult;

interface ActiveJob {
  meetingId: string;
  pid: number;
  child: ChildProcess;
  mediaDir: string;
  startedAt: number;
}

export class WhisperSupervisor {
  private activeJobs = new Map<string, ActiveJob>();
  private isShuttingDown = false;

  constructor() {
    this.setupExitHandlers();
  }

  private setupExitHandlers(): void {
    const handleExit = () => {
      this.killAll();
    };

    // ── Why the signal handlers below are NOT sufficient ──────────────────
    //
    // The shell tears a supervised MCP server down at lifecycle.rs:797 with
    // `tear_down_active().await` followed immediately by `drop(child)`. The
    // Command is built with `kill_on_drop(true)` (lifecycle.rs:1153), which in
    // Tokio is SIGKILL — untrappable. So on shell-initiated shutdown NONE of
    // these handlers run, and whisper is orphaned exactly as it was under the
    // one-shot CLI. Keeping them is still right (they cover a manual `kill`,
    // a supervisor restart, and our own crash) but they must not be mistaken
    // for the mechanism that bounds the orphan.
    //
    // The two things that actually bound it are below: stdin EOF, which is the
    // one signal the shell DOES give us before the SIGKILL, and the startup
    // sweep, which reaps anything that outlived a previous process.
    process.on('SIGTERM', () => {
      handleExit();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      handleExit();
      process.exit(0);
    });

    process.on('exit', () => {
      handleExit();
    });

    // `tear_down_active` drops its stdin sender before dropping the child, so
    // stdin EOF is our earliest — and on a clean shutdown, only — warning.
    // Reap synchronously: there is no grace period to await anything in.
    try {
      process.stdin.on('end', handleExit);
      process.stdin.on('close', handleExit);
    } catch {
      // stdin may not be a stream in some hosts; the sweep still covers us.
    }
  }

  /**
   * Kill whisper processes left behind by a PREVIOUS run of this server.
   *
   * This is the backstop that actually bounds the orphan. A whisper killed by
   * neither a signal handler (SIGKILL is untrappable) nor stdin EOF (the shell
   * may not get that far) survives its supervisor. Because every run records
   * its child's pid in `<mediaDir>/whisper.pid`, a later boot can find those
   * files and reap anything still alive.
   *
   * The bound is therefore "until the next server start", not "forever" — the
   * honest claim, and a testable one.
   */
  async sweepOrphans(mediaRoot: string): Promise<number> {
    let reaped = 0;
    let entries: string[];
    try {
      entries = await fs.readdir(mediaRoot);
    } catch {
      return 0; // no media dir yet — nothing to sweep
    }

    for (const entry of entries) {
      const mediaDir = path.join(mediaRoot, entry);
      const pid = await readWhisperPid(mediaDir).catch(() => null);
      if (pid === null) continue;

      // Never reap a job this process owns — those are live work, not litter.
      const owned = [...this.activeJobs.values()].some((j) => j.pid === pid);
      if (owned) continue;

      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
          reaped++;
        } catch {
          // Not ours to kill, or already gone between check and signal.
        }
      }
      await clearWhisperPid(mediaDir).catch(() => {});
    }
    return reaped;
  }

  /**
   * Terminate all currently active whisper-cli child processes immediately.
   */
  killAll(): void {
    this.isShuttingDown = true;
    for (const [meetingId, job] of this.activeJobs.entries()) {
      try {
        if (job.pid && isProcessAlive(job.pid)) {
          process.kill(job.pid, 'SIGKILL');
        }
      } catch {
        // ignore errors on exit
      }
      try {
        job.child.kill('SIGKILL');
      } catch {
        // ignore
      }
      void clearWhisperPid(job.mediaDir).catch(() => {});
      this.activeJobs.delete(meetingId);
    }
  }

  /**
   * Cancel an active transcription for a given meeting ID.
   */
  async cancel(meetingId: string): Promise<boolean> {
    const job = this.activeJobs.get(meetingId);
    if (!job) return false;

    try {
      if (job.pid && isProcessAlive(job.pid)) {
        process.kill(job.pid, 'SIGKILL');
      }
    } catch {
      // ignore
    }
    try {
      job.child.kill('SIGKILL');
    } catch {
      // ignore
    }
    await clearWhisperPid(job.mediaDir).catch(() => {});
    this.activeJobs.delete(meetingId);
    return true;
  }

  /**
   * Status of an active or recent meeting transcription.
   */
  getStatus(meetingId: string): { active: boolean; pid?: number; elapsed_seconds?: number } {
    const job = this.activeJobs.get(meetingId);
    if (!job || !isProcessAlive(job.pid)) {
      return { active: false };
    }
    return {
      active: true,
      pid: job.pid,
      elapsed_seconds: Math.round((Date.now() - job.startedAt) / 1000),
    };
  }

  /**
   * Supervised transcription of a meeting audio file.
   */
  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    if (this.isShuttingDown) {
      return {
        ok: false,
        meeting_id: options.meetingId,
        error: 'MCP server is shutting down',
      };
    }

    const meetingId = options.meetingId;
    if (!meetingId) {
      return { ok: false, error: 'missing required argument meeting_id' };
    }

    const mediaDir = resolveMeetingMediaDir(meetingId, options.outputDir);
    const paths = getMeetingMediaFilePaths(meetingId, options.outputDir);
    const audioPath = options.audioPath ?? paths.audioPath;

    const stat = await fs.stat(audioPath).catch(() => null);
    if (!stat) {
      return { ok: false, meeting_id: meetingId, error: `audio file not found: ${audioPath}` };
    }
    if (stat.size === 0) {
      return { ok: false, meeting_id: meetingId, error: `audio file is empty: ${audioPath}` };
    }

    // ── Guard against concurrent whisper runs for this meeting ────────────
    const inFlightJob = this.activeJobs.get(meetingId);
    if (inFlightJob && isProcessAlive(inFlightJob.pid)) {
      if (options.force) {
        await this.cancel(meetingId);
      } else {
        return {
          ok: false,
          meeting_id: meetingId,
          error: `a transcription is already running for this meeting (pid ${inFlightJob.pid})`,
          already_running: true,
          pid: inFlightJob.pid,
        };
      }
    }

    // Also check on-disk pid file in case a separate process started one
    const existingPid = await readWhisperPid(mediaDir);
    if (existingPid !== null) {
      if (isProcessAlive(existingPid)) {
        if (options.force) {
          try {
            process.kill(existingPid, 'SIGKILL');
          } catch {
            // ignore
          }
          await clearWhisperPid(mediaDir);
        } else {
          return {
            ok: false,
            meeting_id: meetingId,
            error: `a transcription is already running for this meeting (pid ${existingPid})`,
            already_running: true,
            pid: existingPid,
          };
        }
      } else {
        await clearWhisperPid(mediaDir);
      }
    }

    // ── Reuse existing completed transcript if up-to-date ──────────────────
    const outJsonPrefix = audioPath.replace(/\.wav$/i, '') + '.transcript';
    const outJsonPath = outJsonPrefix + '.json';

    if (!options.force) {
      const jsonStat = await fs.stat(outJsonPath).catch(() => null);
      if (jsonStat && jsonStat.mtimeMs >= stat.mtimeMs) {
        try {
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
        } catch {
          // If reading stale json fails, proceed to transcribe fresh
        }
      }
    }

    // ── Resolve Binary & Model ─────────────────────────────────────────────
    const binaryRes = await resolveWhisperBinary(options.whisperBinaryPath);
    if (!binaryRes.available || !binaryRes.path) {
      return {
        ok: false,
        meeting_id: meetingId,
        error: binaryRes.error ?? 'whisper.cpp binary (whisper-cli) not available.',
      };
    }

    const modelName = options.model ?? DEFAULT_WHISPER_MODEL;
    const modelPath = resolveModelPath(modelName, options.modelDir);
    if (!existsSync(modelPath)) {
      return {
        ok: false,
        meeting_id: meetingId,
        error: `Whisper model ${modelName} not found at ${modelPath}. Please download model weights first.`,
      };
    }

    await ensureMeetingMediaDir(meetingId, options.outputDir);

    const args = [
      '-m', modelPath,
      '-f', audioPath,
      '-oj',
      '-of', outJsonPrefix,
      '-l', options.language ?? 'en',
    ];

    const child = spawn(binaryRes.path, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    if (typeof child.pid !== 'number') {
      return { ok: false, meeting_id: meetingId, error: 'failed to spawn whisper-cli process' };
    }

    const job: ActiveJob = {
      meetingId,
      pid: child.pid,
      child,
      mediaDir,
      startedAt: Date.now(),
    };
    this.activeJobs.set(meetingId, job);
    await writeWhisperPid(mediaDir, child.pid);

    if (options.onSpawn) {
      try {
        await options.onSpawn(child.pid);
      } catch {
        // ignore
      }
    }

    try {
      const exitResult = await new Promise<{ code: number | null; stderr: string }>(
        (resolve, reject) => {
          let stderr = '';
          child.stderr?.on('data', (d) => {
            const chunk = d.toString();
            stderr = (stderr + chunk).slice(-4096);
            if (options.onProgress) {
              options.onProgress(chunk);
            }
          });
          child.on('error', (err) => reject(err));
          child.on('close', (code) => {
            resolve({ code, stderr });
          });
        }
      );

      if (exitResult.code !== 0) {
        return {
          ok: false,
          meeting_id: meetingId,
          error: `whisper.cpp exited with code ${exitResult.code}${
            exitResult.stderr ? `: ${exitResult.stderr.trim()}` : ''
          }`,
        };
      }

      if (!existsSync(outJsonPath)) {
        return {
          ok: false,
          meeting_id: meetingId,
          error: `whisper.cpp did not produce expected JSON output at ${outJsonPath}`,
        };
      }

      const rawContent = await fs.readFile(outJsonPath, 'utf8');
      const parsedJson = JSON.parse(rawContent);
      const segments = parseWhisperCppJson(parsedJson, meetingId);

      return {
        ok: true,
        meeting_id: meetingId,
        audio_path: audioPath,
        segment_count: segments.length,
        segments,
      };
    } catch (err: any) {
      return {
        ok: false,
        meeting_id: meetingId,
        error: err?.message ?? String(err),
      };
    } finally {
      this.activeJobs.delete(meetingId);
      await clearWhisperPid(mediaDir).catch(() => {});
    }
  }
}
