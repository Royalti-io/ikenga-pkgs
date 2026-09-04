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
  /**
   * Optional stereo master: left channel = system monitor (remote
   * participants), right channel = mic (the local speaker) — see D-15.
   *
   * The two legs are separate ffmpeg inputs right up until `amix` folds them
   * into the mono master above, so keeping them apart into a second, stereo
   * output gives exact two-way speaker attribution for free: no diarization
   * model, no gated HuggingFace token. Exact for a 1:1 call; for multi-party
   * it degrades gracefully to "me vs everyone else", which still beats no
   * attribution at all.
   *
   * Only produced on the dual-source path (`isLinuxPulse && mixSystemAndMic
   * !== false`) — a single-device capture never had two legs to keep apart.
   * It is a straight PCM copy of both mono legs at the master's rate, so it
   * roughly DOUBLES the master's on-disk size (two channels instead of one)
   * — worth it for the free attribution, but callers that are disk-conscious
   * can leave this unset and keep only the existing mono outputs.
   */
  outputStereoPath?: string;
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
  // Whether the mix came out of a filter graph — the compressed output must
  // then be mapped from the filter's second pad, not from an input stream.
  let mappedFromFilter = false;
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
    //
    // When a compressed copy is also wanted the mix is `asplit`, because a
    // filter output pad can only be consumed by ONE output — mapping [aout]
    // twice fails with "Filter aout has an unconnected output". The same rule
    // is why the stereo master below is its OWN filter chain (`join`) off the
    // same two inputs, rather than trying to derive it from the mix: [0:a]
    // and [1:a] are re-readable any number of times (ffmpeg auto-`asplit`s an
    // input label that feeds more than one filter chain), but a filter's
    // OUTPUT pad is not.
    const filterChains: string[] = [];
    if (config.outputCompressedPath) {
      filterChains.push(
        '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=0,asplit=2[aout][acomp]'
      );
    } else {
      filterChains.push(
        '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=0[aout]'
      );
    }
    if (config.outputStereoPath) {
      // `join` with an explicit map, not `amerge`: amerge's channel order is
      // implicit (input order) and undocumented for anything but the common
      // case, where `join`'s `map=` pins left/right explicitly so a future
      // reader doesn't have to trust that ffmpeg kept 0 before 1.
      filterChains.push(
        '[0:a][1:a]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[astereo]'
      );
    }
    args.push('-filter_complex', filterChains.join(';'));
    args.push('-map', '[aout]');
    mappedFromFilter = true;
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

  // Optional compressed playback copy.
  //
  // 32 kbps mono AAC, not 128 kbps: this file exists to be shipped into the
  // iframe as base64 over the MCP bridge, where size is the binding constraint
  // (~14 MB/hour at 32k vs ~57 MB at 128k). It carries speech, and the
  // canonical 16 kHz PCM master remains on disk for anything that needs
  // fidelity.
  if (config.outputCompressedPath) {
    if (mappedFromFilter) {
      args.push('-map', '[acomp]');
    }
    args.push(
      '-vn',
      '-c:a', 'aac',
      '-b:a', '32k',
      '-ac', '1',
      config.outputCompressedPath
    );
  }

  // Stereo master (left = monitor/remote, right = mic/local). Only meaningful
  // when the graph actually had two separate legs to keep apart — a
  // single-device capture has nothing to split, so the option is silently
  // ignored there rather than erroring on a config that is valid for the
  // common (dual-source) case.
  if (config.outputStereoPath && mappedFromFilter && isLinuxPulse && config.mixSystemAndMic !== false) {
    args.push(
      '-map', '[astereo]',
      '-vn',
      '-c:a', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '2',
      config.outputStereoPath
    );
  }

  return args;
}

/**
 * Derives the stereo-master sibling path of an `audio.wav` master, e.g.
 * `.../audio.wav` -> `.../audio.stereo.wav`. Kept here (not in
 * `@ikenga/meetings-contract`) so this pkg does not need a contract change to
 * ship the stereo master as an addition to the existing media layout.
 */
export function deriveStereoPath(audioPath: string): string {
  return audioPath.replace(/\.wav$/i, '.stereo.wav');
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
