import { spawn, ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export interface FfmpegGraphConfig {
  videoInput: {
    type: 'x11grab' | 'gdigrab' | 'avfoundation' | 'desktop';
    displayOrWindow?: string;
    framerate?: number;
  };
  audioInput: {
    type: 'pulse' | 'alsa' | 'dshow' | 'avfoundation' | 'default';
    deviceOrSink?: string;
  };
  outputVideoPath: string;
  outputAudioPath: string;
  ffmpegBinary?: string;
}

export interface CaptureSessionStatus {
  active: boolean;
  paused: boolean;
  elapsedSeconds: number;
  videoPath?: string;
  audioPath?: string;
  pid?: number;
}

/**
 * Builds standard parameterized ffmpeg arguments for simultaneously capturing
 * high-compatibility H.264/AAC video.mp4 and 16kHz mono PCM audio.wav.
 */
export function buildFfmpegArgs(config: FfmpegGraphConfig): string[] {
  const args: string[] = ['-y'];
  const fps = config.videoInput.framerate ?? 20;
  const platform = os.platform();

  // Video input configuration
  if (config.videoInput.type === 'x11grab' || (config.videoInput.type === 'desktop' && platform === 'linux')) {
    const display = config.videoInput.displayOrWindow ?? process.env['DISPLAY'] ?? ':0.0';
    args.push('-f', 'x11grab', '-framerate', String(fps), '-i', display);
  } else if (config.videoInput.type === 'gdigrab' || (config.videoInput.type === 'desktop' && platform === 'win32')) {
    args.push('-f', 'gdigrab', '-framerate', String(fps), '-i', config.videoInput.displayOrWindow ?? 'desktop');
  } else if (config.videoInput.type === 'avfoundation' || (config.videoInput.type === 'desktop' && platform === 'darwin')) {
    args.push('-f', 'avfoundation', '-framerate', String(fps), '-i', config.videoInput.displayOrWindow ?? '1:none');
  }

  // Audio input configuration
  if (config.audioInput.type === 'pulse' || (config.audioInput.type === 'default' && platform === 'linux')) {
    const device = config.audioInput.deviceOrSink ?? 'default';
    args.push('-f', 'pulse', '-i', device);
  } else if (config.audioInput.type === 'dshow' || (config.audioInput.type === 'default' && platform === 'win32')) {
    const device = config.audioInput.deviceOrSink ?? 'audio=virtual-audio-capturer';
    args.push('-f', 'dshow', '-i', device);
  } else if (config.audioInput.type === 'avfoundation' || (config.audioInput.type === 'default' && platform === 'darwin')) {
    const device = config.audioInput.deviceOrSink ?? ':0';
    args.push('-f', 'avfoundation', '-i', device);
  }

  // Output 1: Video MP4 (H.264 + AAC 128k, faststart)
  args.push(
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    config.outputVideoPath
  );

  // Output 2: Audio WAV (16kHz 16-bit Mono PCM for Whisper STT)
  args.push(
    '-vn',
    '-c:a', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    config.outputAudioPath
  );

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
        // ffmpeg logs progress to stderr
        if (!started && (text.includes('Stream #') || text.includes('Output #') || text.includes('frame='))) {
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
        const wasRunning = this.startTime !== null;
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

  async stop(): Promise<{ videoPath: string; audioPath: string; durationSeconds: number }> {
    if (!this.child || !this.currentConfig || !this.startTime) {
      throw new Error('No active capture session to stop.');
    }

    const durationSeconds = Math.max(1, Math.round((Date.now() - this.startTime) / 1000));
    const config = this.currentConfig;

    return new Promise((resolve) => {
      const child = this.child;
      if (!child) {
        resolve({
          videoPath: config.outputVideoPath,
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
          videoPath: config.outputVideoPath,
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
      videoPath: this.currentConfig?.outputVideoPath,
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
