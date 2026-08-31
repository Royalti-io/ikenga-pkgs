import { EventEmitter } from 'node:events';
import { MeetingAdapter, JoinMeetingOptions } from './base.js';
import { GOOGLE_MEET_SELECTORS } from './selectors.js';

export interface PageDriver {
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<any>;
  isVisible(selector: string): Promise<boolean>;
  url(): string;
  content(): Promise<string>;
}

export class GoogleMeetAdapter extends EventEmitter implements MeetingAdapter {
  private inCall: boolean = false;
  private driver: PageDriver | null = null;

  constructor(driver?: PageDriver) {
    super();
    this.driver = driver ?? null;
  }

  setDriver(driver: PageDriver): void {
    this.driver = driver;
  }

  async join(options: JoinMeetingOptions): Promise<void> {
    if (!this.driver) {
      throw new Error('GoogleMeetAdapter: No page driver configured.');
    }

    // 1. Navigate to Meet URL
    await this.driver.goto(options.url);

    // 2. Mute camera & microphone prior to entry
    await this.muteAudioAndVideo();

    // 3. Fill guest name if name prompt is shown
    try {
      if (await this.driver.isVisible(GOOGLE_MEET_SELECTORS.NAME_INPUT)) {
        await this.driver.fill(GOOGLE_MEET_SELECTORS.NAME_INPUT, options.botName);
      }
    } catch {
      // ignore
    }

    // 4. Click Ask to Join / Join Now button
    try {
      await this.driver.click(GOOGLE_MEET_SELECTORS.ASK_TO_JOIN_BUTTON);
    } catch {
      await this.driver.click(GOOGLE_MEET_SELECTORS.JOIN_NOW_BUTTON);
    }

    // 5. Wait for call to be active (leave call button visible)
    await this.driver.waitForSelector(GOOGLE_MEET_SELECTORS.LEAVE_CALL_BUTTON, { timeout: 30000 });
    this.inCall = true;
    this.emit('joined');

    // 6. Send join announcement copy into meeting chat
    const disclosure =
      options.disclosureMessage ??
      `Hello! I am ${options.botName}. I am recording this session locally for transcription and action item tracking. If anyone objects, type !stop at any time.`;

    await this.sendChatMessage(disclosure);
  }

  async muteAudioAndVideo(): Promise<void> {
    if (!this.driver) return;
    try {
      if (await this.driver.isVisible(GOOGLE_MEET_SELECTORS.MUTE_MIC_BUTTON)) {
        await this.driver.click(GOOGLE_MEET_SELECTORS.MUTE_MIC_BUTTON);
      }
    } catch {
      // ignore
    }

    try {
      if (await this.driver.isVisible(GOOGLE_MEET_SELECTORS.MUTE_CAM_BUTTON)) {
        await this.driver.click(GOOGLE_MEET_SELECTORS.MUTE_CAM_BUTTON);
      }
    } catch {
      // ignore
    }
  }

  async sendChatMessage(message: string): Promise<void> {
    if (!this.driver) return;
    try {
      if (await this.driver.isVisible(GOOGLE_MEET_SELECTORS.CHAT_BUTTON)) {
        await this.driver.click(GOOGLE_MEET_SELECTORS.CHAT_BUTTON);
      }
      await this.driver.waitForSelector(GOOGLE_MEET_SELECTORS.CHAT_INPUT, { timeout: 5000 });
      await this.driver.fill(GOOGLE_MEET_SELECTORS.CHAT_INPUT, message);
      await this.driver.click(GOOGLE_MEET_SELECTORS.CHAT_SEND_BUTTON);
    } catch {
      // ignore if chat disabled by host
    }
  }

  async leave(): Promise<void> {
    if (!this.driver || !this.inCall) return;
    try {
      await this.driver.click(GOOGLE_MEET_SELECTORS.LEAVE_CALL_BUTTON);
    } catch {
      // ignore
    } finally {
      this.inCall = false;
      this.emit('left');
    }
  }

  isInCall(): boolean {
    return this.inCall;
  }
}
