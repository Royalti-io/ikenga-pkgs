import { spawn, ChildProcess, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export interface XvfbOptions {
  display?: string; // default ':99'
  width?: number; // default 1280
  height?: number; // default 720
  depth?: number; // default 24
}

export class XvfbServer {
  private process: ChildProcess | null = null;
  public display: string;

  constructor(options?: XvfbOptions) {
    this.display = options?.display ?? process.env['IKENGA_XVFB_DISPLAY'] ?? ':99';
  }

  async start(options?: XvfbOptions): Promise<string> {
    if (os.platform() !== 'linux') {
      // Non-Linux uses native desktop display
      return process.env['DISPLAY'] ?? ':0';
    }

    if (this.process) {
      return this.display;
    }

    const width = options?.width ?? 1280;
    const height = options?.height ?? 720;
    const depth = options?.depth ?? 24;

    return new Promise((resolve, reject) => {
      const child = spawn(
        'Xvfb',
        [this.display, '-screen', '0', `${width}x${height}x${depth}`, '-ac', '-nolisten', 'tcp'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      this.process = child;

      child.on('error', (err) => {
        this.process = null;
        reject(new Error(`Failed to start Xvfb: ${err.message}. Ensure xvfb is installed.`));
      });

      // Check if Xvfb started successfully
      setTimeout(() => {
        if (this.process) {
          process.env['DISPLAY'] = this.display;
          resolve(this.display);
        }
      }, 500);
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      const child = this.process;
      this.process = null;
      if (!child) return resolve();

      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 1000);

      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.process !== null;
  }
}
