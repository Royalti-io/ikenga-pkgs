import { XvfbServer } from '../capture/xvfb.js';
import { VirtualAudioSinkManager } from '../capture/audio-sink.js';

export interface BrowserLaunchOptions {
  headless?: boolean;
  display?: string;
  storageState?: string | Record<string, unknown>;
}

export class BotBrowserHost {
  private xvfb: XvfbServer | null = null;
  private sinkManager: VirtualAudioSinkManager | null = null;
  public display: string = ':0';
  public audioDevice: string = 'default';

  async initialize(options?: BrowserLaunchOptions): Promise<{ display: string; audioDevice: string }> {
    this.xvfb = new XvfbServer({ display: options?.display });
    this.display = await this.xvfb.start();

    this.sinkManager = new VirtualAudioSinkManager();
    this.audioDevice = await this.sinkManager.setup();

    return {
      display: this.display,
      audioDevice: this.audioDevice,
    };
  }

  getChromiumArgs(): string[] {
    return [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--display=${this.display}`,
    ];
  }

  async close(): Promise<void> {
    if (this.sinkManager) {
      await this.sinkManager.teardown();
      this.sinkManager = null;
    }
    if (this.xvfb) {
      await this.xvfb.stop();
      this.xvfb = null;
    }
  }
}
