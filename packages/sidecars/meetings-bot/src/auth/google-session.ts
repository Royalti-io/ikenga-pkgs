import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface GoogleSessionState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export class GoogleSessionManager {
  private customSessionDir?: string;

  constructor(customSessionDir?: string) {
    this.customSessionDir = customSessionDir;
  }

  getSessionFilePath(): string {
    const dir = this.customSessionDir ?? path.join(os.homedir(), '.ikenga', 'sessions');
    return path.join(dir, 'google-session.json');
  }

  async hasSavedSession(): Promise<boolean> {
    return existsSync(this.getSessionFilePath());
  }

  async loadSession(): Promise<GoogleSessionState | null> {
    const filePath = this.getSessionFilePath();
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as GoogleSessionState;
    } catch {
      return null;
    }
  }

  async saveSession(state: GoogleSessionState): Promise<void> {
    const filePath = this.getSessionFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  async isSessionExpired(): Promise<boolean> {
    const session = await this.loadSession();
    if (!session || !session.cookies || session.cookies.length === 0) {
      return true;
    }
    const nowSecs = Math.floor(Date.now() / 1000);
    // If all login SID/SSID/HSID cookies are expired
    const authCookies = session.cookies.filter((c) =>
      ['SID', 'SSID', 'HSID', 'SAPISID', '__Secure-3PSID'].includes(c.name)
    );
    if (authCookies.length === 0) {
      return true;
    }
    return authCookies.every((c) => c.expires > 0 && c.expires < nowSecs);
  }

  async clearSession(): Promise<void> {
    const filePath = this.getSessionFilePath();
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  }
}
