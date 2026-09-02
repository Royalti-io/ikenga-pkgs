import { spawn, ChildProcess } from 'node:child_process';
import os from 'node:os';
import { EventEmitter } from 'node:events';

export interface FfmpegGraphConfig {
  audioInput: {
    type: 'pulse' | 'alsa' | 'dshow' | 'avfoundation' | 'default';
    deviceOrSink?: string;
  };
  /**
   * Capture BOTH sides of the conversation, not just one.
   *
   * A meeting has two audio paths that never meet in the OS: remote
   * participants arrive on the output sink (you hear them) and the local
   * speaker arrives on the input source (your mic). Recording a single
   * device therefore always loses half the meeting — capturing
   * `@DEFAULT_SOURCE@` alone yields a tape of you talking into silence,
   * which is the failure the first cut of this file shipped with.
   *
   * When true (the default for `local_recording`) the graph opens the
   * default sink MONITOR and the default mic as two inputs and `amix`es
   * them into one mono track. PulseAudio/PipeWire-Pulse resolve the
   * `@DEFAULT_*@` aliases at open time, so switching headphones mid-session
   * does not need a re-plumb, and no `pactl` is required — ffmpeg talks to
   * libpulse directly.
   */
  mixSystemAndMic?: boolean;
  outputAudioPath: string;
  outputCompressedPath?: string;
  ffmpegBinary?: string;
}

/** PulseAudio server-resolved alias for the monitor of the current default
 *  sink — i.e. everything the machine is playing (the remote participants). */
export const DEFAULT_MONITOR_DEVICE = '@DEFAULT_MONITOR@';
/** PulseAudio server-resolved alias for the current default input (the mic). */
export const DEFAULT_SOURCE_DEVICE = '@DEFAULT_SOURCE@';

export interface CaptureSessionStatus {
  active: boolean;
  paused: boolean;
  elapsedSeconds: number;
  audioPath?: string;
  pid?: number;
}

/**
 * Builds standard parameterized ffmpeg arguments for capturing high-fidelity,
 * zero-overhead audio (16kHz mono PCM audio.wav for Whisper STT).
 */
export function buildFfmpegArgs(config: FfmpegGraphConfig): string[] {
  const args: string[] = ['-y'];
  const platform = os.platform();
  const isLinuxPulse =
    config.audioInput.type === 'pulse' ||
    (config.audioInput.type === 'default' && platform === 'linux');

  // ── Dual-source path: system audio + mic, mixed ────────────────────────
  // Only PulseAudio exposes a monitor device this cleanly, so the mix is
  // Linux-only for now; other platforms fall through to the single-device
  // path below and are a separate port (mirrors the Xvfb bot scoping).
  if (isLinuxPulse && config.mixSystemAndMic !== false) {
    // `thread_queue_size` is raised off its default of 8 because two live
    // pulse captures feeding one filter graph will otherwise log
    // "Thread message queue blocking" and drop packets on the input that
    // loses the race — audible as clipped syllables in the transcript.
    args.push(
      '-thread_queue_size', '1024',
      '-f', 'pulse', '-i', config.audioInput.deviceOrSink ?? DEFAULT_MONITOR_DEVICE,
      '-thread_queue_size', '1024',
      '-f', 'pulse', '-i', DEFAULT_SOURCE_DEVICE
    );
    // `duration=longest` keeps recording while either side is live, so the
    // tape does not stop when one party mutes. `dropout_transition=0`
    // suppresses amix's default 2s volume ramp when an input goes quiet —
    // without it every pause re-normalises the gain and the speech that
    // follows comes back at the wrong level.
    args.push(
      '-filter_complex',
      '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=0[aout]',
      '-map', '[aout]'
    );
  } else {
    // ── Single-device path (non-Linux, or explicit opt-out) ──────────────
    if (isLinuxPulse) {
      const device = config.audioInput.deviceOrSink ?? DEFAULT_MONITOR_DEVICE;
      args.push('-f', 'pulse', '-i', device);
    } else if (config.audioInput.type === 'dshow' || (config.audioInput.type === 'default' && platform === 'win32')) {
      const device = config.audioInput.deviceOrSink ?? 'audio=virtual-audio-capturer';
      args.push('-f', 'dshow', '-i', device);
    } else if (config.audioInput.type === 'avfoundation' || (config.audioInput.type === 'default' && platform === 'darwin')) {
      const device = config.audioInput.deviceOrSink ?? ':0';
      args.push('-f', 'avfoundation', '-i', device);
    }
  }

  // Audio Output: 16kHz 16-bit Mono PCM — whisper.cpp's native input format,
  // so no resample step is needed between capture and STT.
  args.push(
    '-vn',
    '-c:a', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    config.outputAudioPath
  );

  // Optional compressed output (AAC/M4A) for lightweight archiving.
  if (config.outputCompressedPath) {
    args.push(
      '-vn',
      '-c:a', 'aac',
      '-b:a', '128k',
      config.outputCompressedPath
    );
  }

  return args;
}

export class FfmpegCaptureSession extends EventEmitter {
  private child: ChildProcess | null = null;
  private startTime: number | null = null;
  private paused: boolean = false;
  private currentConfig: FfmpegGraphConfig | null = null;

  start(config: FfmpegGraphConfig): Promise<void> {
    if (this.child) {
      throw new Error('Capture session is already running.');
    }

    this.currentConfig = config;
    const binary = config.ffmpegBinary ?? 'ffmpeg';
    const args = buildFfmpegArgs(config);

    return new Promise((resolve, reject) => {
      let started = false;
      const child = spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.child = child;
      this.startTime = Date.now();
      this.paused = false;

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        // ffmpeg logs stream information to stderr
        if (!started && (text.includes('Stream #') || text.includes('Output #') || text.includes('size='))) {
          started = true;
          this.emit('started');
          resolve();
        }
      });

      child.on('error', (err) => {
        this.cleanup();
        this.emit('error', err);
        if (!started) {
          reject(err);
        }
      });

      child.on('close', (code) => {
        this.cleanup();
        this.emit('stopped', { exitCode: code });
        if (!started && code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code} before starting.`));
        }
      });

      // Timeout fallback for resolve
      setTimeout(() => {
        if (!started && this.child) {
          started = true;
          resolve();
        }
      }, 500);
    });
  }

  async stop(): Promise<{ audioPath: string; durationSeconds: number }> {
    if (!this.child || !this.currentConfig || !this.startTime) {
      throw new Error('No active capture session to stop.');
    }

    const durationSeconds = Math.max(1, Math.round((Date.now() - this.startTime) / 1000));
    const config = this.currentConfig;

    return new Promise((resolve) => {
      const child = this.child;
      if (!child) {
        resolve({
          audioPath: config.outputAudioPath,
          durationSeconds,
        });
        return;
      }

      // Send 'q' to stdin for clean ffmpeg exit
      try {
        child.stdin?.write('q\n');
      } catch {
        child.kill('SIGTERM');
      }

      // Give 2 seconds for clean stop, then force SIGKILL
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 2000);

      child.once('close', () => {
        clearTimeout(killTimer);
        this.cleanup();
        resolve({
          audioPath: config.outputAudioPath,
          durationSeconds,
        });
      });
    });
  }

  getStatus(): CaptureSessionStatus {
    const elapsedSeconds = this.startTime
      ? Math.round((Date.now() - this.startTime) / 1000)
      : 0;

    return {
      active: this.child !== null,
      paused: this.paused,
      elapsedSeconds,
      audioPath: this.currentConfig?.outputAudioPath,
      pid: this.child?.pid,
    };
  }

  private cleanup(): void {
    this.child = null;
    this.startTime = null;
    this.paused = false;
  }
}
