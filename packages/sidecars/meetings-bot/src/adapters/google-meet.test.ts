import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleMeetAdapter, PageDriver } from './google-meet.js';

class MockPageDriver implements PageDriver {
  public navigatedUrl: string = '';
  public clickedSelectors: string[] = [];
  public filledFields: Array<{ selector: string; value: string }> = [];

  async goto(url: string): Promise<void> {
    this.navigatedUrl = url;
  }
  async click(selector: string): Promise<void> {
    this.clickedSelectors.push(selector);
  }
  async fill(selector: string, value: string): Promise<void> {
    this.filledFields.push({ selector, value });
  }
  async waitForSelector(): Promise<any> {
    return true;
  }
  async isVisible(): Promise<boolean> {
    return true;
  }
  url(): string {
    return this.navigatedUrl;
  }
  async content(): Promise<string> {
    return '<html></html>';
  }
}

describe('GoogleMeetAdapter', () => {
  it('joins meeting with muted media, fills guest name, and sends disclosure', async () => {
    const mockDriver = new MockPageDriver();
    const adapter = new GoogleMeetAdapter(mockDriver);

    let joinedEmitted = false;
    adapter.on('joined', () => {
      joinedEmitted = true;
    });

    await adapter.join({
      url: 'https://meet.google.com/abc-defg-hij',
      botName: 'Ikenga Meeting Bot',
    });

    assert.equal(mockDriver.navigatedUrl, 'https://meet.google.com/abc-defg-hij');
    assert.equal(adapter.isInCall(), true);
    assert.equal(joinedEmitted, true);

    // Verify name was filled
    const nameFill = mockDriver.filledFields.find((f) => f.value === 'Ikenga Meeting Bot');
    assert.ok(nameFill);

    // Verify chat disclosure was sent
    const chatFill = mockDriver.filledFields.find((f) => f.value.includes('!stop'));
    assert.ok(chatFill);
    assert.ok(chatFill.value.includes('Ikenga Meeting Bot'));
  });

  it('leaves meeting cleanly on leave()', async () => {
    const mockDriver = new MockPageDriver();
    const adapter = new GoogleMeetAdapter(mockDriver);
    await adapter.join({
      url: 'https://meet.google.com/abc-defg-hij',
      botName: 'Ikenga Bot',
    });

    assert.equal(adapter.isInCall(), true);
    await adapter.leave();
    assert.equal(adapter.isInCall(), false);
  });
});
