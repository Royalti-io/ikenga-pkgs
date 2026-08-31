import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export interface VirtualAudioSinkOptions {
  sinkName?: string;
}

export class VirtualAudioSinkManager {
  private moduleIndex: string | null = null;
  public readonly sinkName: string;

  constructor(options?: VirtualAudioSinkOptions) {
    this.sinkName = options?.sinkName ?? 'ikenga_meetings_sink';
  }

  async setup(): Promise<string> {
    if (os.platform() !== 'linux') {
      return 'default';
    }

    try {
      const { stdout } = await execFileAsync('pactl', [
        'load-module',
        'module-null-sink',
        `sink_name=${this.sinkName}`,
        'sink_properties=device.description=IkengaMeetingsVirtualSink',
      ]);
      this.moduleIndex = stdout.trim();
      return `${this.sinkName}.monitor`;
    } catch {
      // If pactl load-module fails or pactl is absent, return default monitor
      return 'default';
    }
  }

  async teardown(): Promise<void> {
    if (!this.moduleIndex || os.platform() !== 'linux') {
      return;
    }

    try {
      await execFileAsync('pactl', ['unload-module', this.moduleIndex]);
    } catch {
      // ignore
    } finally {
      this.moduleIndex = null;
    }
  }
}
