import readline from 'node:readline';
import {
  RecorderControlRequestSchema,
  RecordingConfig,
  RecordingStatusNotification,
  RecordingStatusNotificationSchema,
} from '@ikenga/meetings-contract';
import { FfmpegCaptureSession, FfmpegGraphConfig } from './capture/ffmpeg-graph.js';
import { resolveMeetingMediaDir, getMeetingMediaFilePaths, ensureMeetingMediaDir } from '@ikenga/meetings-contract';
import { LocalWhisperEngine } from './whisper/engine.js';
import { runCapturePreflight } from './capture/preflight.js';

export class MeetingsBotSidecar {
  private captureSession: FfmpegCaptureSession = new FfmpegCaptureSession();
  private currentConfig: RecordingConfig | null = null;
  private currentMeetingId: string | null = null;
  private whisperEngine: LocalWhisperEngine = new LocalWhisperEngine();

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    this.captureSession.on('started', () => {
      this.sendNotification('recorder.onStatus', {
        meeting_id: this.currentMeetingId ?? '',
        state: 'recording',
        elapsed_seconds: 0,
      });
    });

    this.captureSession.on('error', (err: Error) => {
      this.sendNotification('recorder.onStatus', {
        meeting_id: this.currentMeetingId ?? '',
        state: 'failed',
        elapsed_seconds: 0,
        error: err.message,
      });
    });
  }

  async handleRequest(raw: unknown): Promise<unknown> {
    const req = RecorderControlRequestSchema.parse(raw);

    switch (req.method) {
      case 'ping': {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { pong: true, time: new Date().toISOString() },
        };
      }

      case 'recorder.status': {
        const status = this.captureSession.getStatus();
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            meeting_id: this.currentMeetingId,
            state: status.active ? (status.paused ? 'paused' : 'recording') : 'idle',
            elapsed_seconds: status.elapsedSeconds,
            audio_path: status.audioPath,
          },
        };
      }

      case 'recorder.start': {
        const config = req.params;
        this.currentConfig = config;
        this.currentMeetingId = config.meeting_id;

        // Preflight
        const preflight = await runCapturePreflight({
          mode: config.backend === 'bot' ? 'bot' : 'local_recording',
        });
        if (!preflight.ok) {
          throw new Error(`Preflight failed: ${preflight.errors.join('; ')}`);
        }

        const mediaDir = await ensureMeetingMediaDir(config.meeting_id, config.output_dir);
        const paths = getMeetingMediaFilePaths(config.meeting_id, config.output_dir);

        const graphConfig: FfmpegGraphConfig = {
          audioInput: {
            type: config.backend === 'bot' ? 'pulse' : 'default',
          },
          outputAudioPath: paths.audioPath,
        };

        await this.captureSession.start(graphConfig);

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            ok: true,
            meeting_id: config.meeting_id,
            media_dir: mediaDir,
            audio_path: paths.audioPath,
          },
        };
      }

      case 'recorder.stop': {
        const res = await this.captureSession.stop();
        const meetingId = this.currentMeetingId;
        this.currentConfig = null;
        this.currentMeetingId = null;

        this.sendNotification('recorder.onStatus', {
          meeting_id: meetingId ?? '',
          state: 'stopped',
          elapsed_seconds: res.durationSeconds,
          audio_path: res.audioPath,
        });

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            ok: true,
            duration_seconds: res.durationSeconds,
            audio_path: res.audioPath,
          },
        };
      }

      case 'recorder.pause': {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { ok: true },
        };
      }

      case 'recorder.resume': {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { ok: true },
        };
      }

      default:
        throw new Error(`Unsupported method`);
    }
  }

  sendNotification(method: string, params: any): void {
    const payload = {
      jsonrpc: '2.0',
      method,
      params,
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
  }

  startStdio(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const json = JSON.parse(trimmed);
        const res = await this.handleRequest(json);
        if (res) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch (err: any) {
        const errPayload = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: err.message ?? 'Internal RPC Error',
          },
        };
        process.stdout.write(JSON.stringify(errPayload) + '\n');
      }
    });

    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async shutdown(): Promise<void> {
    try {
      if (this.captureSession.getStatus().active) {
        await this.captureSession.stop();
      }
    } catch {
      // ignore
    }
    process.exit(0);
  }
}

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sidecar.js')) {
  const sidecar = new MeetingsBotSidecar();
  sidecar.startStdio();
}
