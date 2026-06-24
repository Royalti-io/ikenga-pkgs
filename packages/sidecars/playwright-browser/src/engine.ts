// Playwright verb engine — the backend that replaces the Rust chromiumoxide
// engine behind Ikenga's /iyke/browser/* contract (plans/playwright-adoption,
// ADR-018, WP-03). Pure Playwright (locators + auto-waiting — the value of
// adopting Playwright), with a mode-agnostic `data-ik-ref` ref scheme so the
// same code path works for `managed` (launched dedicated profile) and `attach`
// (the user's everyday Chrome via the official extension) — no CDP-session
// dependency, so refs survive the extension transport.
//
// This module is transport-agnostic: a thin stdio-JSON / HTTP wrapper (WP-04)
// exposes these methods over the bridge. Verb names + request/response shapes
// mirror the existing handlers so the wire contract is preserved.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import os from 'node:os';
import path from 'node:path';

export type Mode = 'managed' | 'attach';

interface Session {
  context: BrowserContext;
  page: Page;
  mode: Mode;
  partition: string;
}

export interface SnapshotNode {
  ref: string;
  tag: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
}

export interface OpenInput {
  pane_id: string;
  url: string;
  mode?: Mode;
  partition?: string;
}

const DEFAULT_PARTITION = 'default';

// The snapshot tagger: runs in the page, clears prior refs, assigns `e<N>` to
// every interactive element, returns the structured node list. `refs invalidate
// on the next snapshot` (contract) falls out naturally — each call re-tags.
const TAG_SCRIPT = `(() => {
  const SEL = 'a[href],button,input,textarea,select,[role],[onclick],[tabindex]:not([tabindex="-1"]),summary,details';
  document.querySelectorAll('[data-ik-ref]').forEach(e => e.removeAttribute('data-ik-ref'));
  let n = 0; const nodes = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(SEL)) {
    if (seen.has(el)) continue; seen.add(el);
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const ref = 'e' + (++n);
    el.setAttribute('data-ik-ref', ref);
    const tag = el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
    nodes.push({
      ref, tag,
      role: el.getAttribute('role') || tag,
      name,
      value: ('value' in el && el.value !== undefined) ? el.value : undefined,
      disabled: el.disabled || undefined,
      checked: (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : undefined,
    });
  }
  return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 200), nodes };
})()`;

export class PlaywrightBrowserEngine {
  private sessions = new Map<string, Session>();
  private managedBrowser: BrowserContext | null = null;

  /** Open a pane. `managed` launches the installed Chrome on a dedicated profile
   *  (the no-extension path); `attach` connects to the user's everyday Chrome via
   *  the official Playwright extension (WP-02 — connection wiring lands there). */
  async open(input: OpenInput): Promise<{ pane_id: string; url: string; mode: Mode; partition: string }> {
    const mode: Mode = input.mode ?? 'managed';
    const partition = input.partition ?? DEFAULT_PARTITION;
    if (this.sessions.has(input.pane_id)) throw new Error(`pane ${input.pane_id} already open`);

    let context: BrowserContext;
    if (mode === 'managed') {
      const profileDir = path.join(os.tmpdir(), `ikenga-pw-${partition}`);
      context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: process.env.IKENGA_PW_HEADLESS !== '0',
      });
    } else {
      // attach: the official Playwright extension exposes a CDP endpoint for the
      // live tab; WP-02 wires `connectOverCDP`/extension pairing. Stubbed clearly
      // so the managed path stays fully testable now.
      throw new Error('attach mode requires the official Playwright extension (WP-02); managed mode is available now');
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(input.url, { waitUntil: 'load' });
    this.sessions.set(input.pane_id, { context, page, mode, partition });
    return { pane_id: input.pane_id, url: input.url, mode, partition };
  }

  private session(pane_id: string): Session {
    const s = this.sessions.get(pane_id);
    if (!s) throw new Error(`unknown pane ${pane_id} (open it first)`);
    return s;
  }

  async goto(pane_id: string, url: string): Promise<{ url: string }> {
    const { page } = this.session(pane_id);
    await page.goto(url, { waitUntil: 'load' });
    return { url: page.url() };
  }

  async back(pane_id: string) { await this.session(pane_id).page.goBack(); return { url: this.session(pane_id).page.url() }; }
  async forward(pane_id: string) { await this.session(pane_id).page.goForward(); return { url: this.session(pane_id).page.url() }; }
  async reload(pane_id: string) { await this.session(pane_id).page.reload(); return { url: this.session(pane_id).page.url() }; }

  /** Accessibility-ish snapshot: re-tag interactive elements and return refs. */
  async snapshot(pane_id: string, opts: { query?: string } = {}): Promise<{
    url: string; title: string; text: string; nodes: SnapshotNode[];
  }> {
    const { page } = this.session(pane_id);
    const snap = (await page.evaluate(TAG_SCRIPT)) as {
      url: string; title: string; text: string; nodes: SnapshotNode[];
    };
    if (opts.query) {
      const q = opts.query.toLowerCase();
      snap.nodes = snap.nodes.filter((nde) =>
        nde.role.toLowerCase().includes(q) || nde.name.toLowerCase().includes(q));
    }
    return snap;
  }

  private locator(pane_id: string, ref: string) {
    return this.session(pane_id).page.locator(`[data-ik-ref="${ref}"]`);
  }

  /** Click a ref — Playwright's actionability/auto-wait does the heavy lifting. */
  async click(pane_id: string, ref: string): Promise<{ ok: true }> {
    await this.locator(pane_id, ref).click();
    return { ok: true };
  }

  async fill(pane_id: string, ref: string, text: string, replace = true): Promise<{ ok: true }> {
    const loc = this.locator(pane_id, ref);
    if (replace) await loc.fill(text);
    else { await loc.click(); await this.session(pane_id).page.keyboard.type(text); }
    return { ok: true };
  }

  async select(pane_id: string, ref: string, value: string): Promise<{ ok: true }> {
    await this.locator(pane_id, ref).selectOption({ label: value }).catch(() =>
      this.locator(pane_id, ref).selectOption(value));
    return { ok: true };
  }

  async pressKey(pane_id: string, combo: string): Promise<{ ok: true }> {
    await this.session(pane_id).page.keyboard.press(combo.replace(/\+/g, '+'));
    return { ok: true };
  }

  /** eval — honors the IIFE-`return` contract (shell PR #46): the script is a
   *  function body that must `return`, identical on both engines. */
  async eval(pane_id: string, script: string): Promise<unknown> {
    return this.session(pane_id).page.evaluate(`(() => { ${script} })()`);
  }

  async screenshot(pane_id: string): Promise<{ bytes: number; base64: string; width: number; height: number }> {
    const { page } = this.session(pane_id);
    const buf = await page.screenshot({ type: 'png' });
    const vp = page.viewportSize() ?? { width: 0, height: 0 };
    return { bytes: buf.length, base64: buf.toString('base64'), width: vp.width, height: vp.height };
  }

  async waitFor(pane_id: string, kind: string, value: string | undefined, timeout_ms = 10_000): Promise<{ satisfied: boolean }> {
    const { page } = this.session(pane_id);
    try {
      switch (kind) {
        case 'url': await page.waitForURL((u) => u.toString().includes(value ?? ''), { timeout: timeout_ms }); break;
        case 'selector': await page.waitForSelector(value!, { timeout: timeout_ms }); break;
        case 'gone-selector': await page.waitForSelector(value!, { state: 'detached', timeout: timeout_ms }); break;
        case 'text': await page.getByText(value!).first().waitFor({ timeout: timeout_ms }); break;
        case 'idle': await page.waitForLoadState('networkidle', { timeout: timeout_ms }); break;
        default: throw new Error(`unknown wait kind ${kind}`);
      }
      return { satisfied: true };
    } catch { return { satisfied: false }; }
  }

  async close(pane_id: string): Promise<{ ok: true }> {
    const s = this.sessions.get(pane_id);
    if (s) { await s.context.close().catch(() => {}); this.sessions.delete(pane_id); }
    return { ok: true };
  }

  async list(): Promise<{ panes: Array<{ pane_id: string; current_url: string; mode: Mode; partition: string }> }> {
    const panes = [...this.sessions.entries()].map(([pane_id, s]) => ({
      pane_id, current_url: s.page.url(), mode: s.mode, partition: s.partition,
    }));
    return { panes };
  }

  async shutdown() {
    for (const s of this.sessions.values()) await s.context.close().catch(() => {});
    this.sessions.clear();
    if (this.managedBrowser) await this.managedBrowser.close().catch(() => {});
  }
}
