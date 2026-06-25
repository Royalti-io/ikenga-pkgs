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
  paused: boolean;
}

/** A target spec for the interaction verbs — exactly one of ref / selector / text,
 *  matching the WebKit engine's `require_one_target`. */
export interface Target {
  ref?: string | null;
  selector?: string | null;
  text?: string | null;
}

// attach mode default. `connectOverCDP` accepts either an http(s) base (it probes
// /json/version for the ws endpoint) or a ws:// endpoint directly. The default
// targets the standard Chrome remote-debugging port; override with the env var
// when the user (or the official Playwright extension relay) exposes a different
// endpoint. See `how_to_live_test` for the exact Chrome launch incantation.
const ATTACH_ENDPOINT_ENV = 'IKENGA_PW_ATTACH_ENDPOINT';
const DEFAULT_ATTACH_ENDPOINT = 'http://127.0.0.1:9222';

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
  // Single CDP connection to the user's everyday Chrome, shared by every attach
  // pane. `connectOverCDP` returns a Browser whose `close()` only *disconnects*
  // the CDP transport — it never kills the user's real Chrome process.
  private attachBrowser: Browser | null = null;

  /** Open a pane. `managed` launches the installed Chrome on a dedicated profile
   *  (the no-extension path); `attach` connects over CDP to the user's everyday
   *  Chrome (default endpoint http://127.0.0.1:9222, override via
   *  IKENGA_PW_ATTACH_ENDPOINT) and adopts its live tab. */
  async open(input: OpenInput): Promise<{ pane_id: string; url: string; mode: Mode; partition: string }> {
    const mode: Mode = input.mode ?? 'managed';
    const partition = input.partition ?? DEFAULT_PARTITION;
    if (this.sessions.has(input.pane_id)) throw new Error(`pane ${input.pane_id} already open`);

    let context: BrowserContext;
    let page: Page;
    if (mode === 'managed') {
      const profileDir = path.join(os.tmpdir(), `ikenga-pw-${partition}`);
      context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: process.env.IKENGA_PW_HEADLESS !== '0',
      });
      page = context.pages()[0] ?? (await context.newPage());
      await page.goto(input.url, { waitUntil: 'load' });
    } else {
      // attach: connect over CDP to the user's everyday Chrome and adopt its
      // live/active tab as this pane's page, so every downstream verb
      // (snapshot/click/fill/eval/screenshot via data-ik-ref) works unchanged.
      ({ context, page } = await this.attach(input.url));
    }

    this.sessions.set(input.pane_id, { context, page, mode, partition, paused: false });
    return { pane_id: input.pane_id, url: input.url, mode, partition };
  }

  /** Attach to the user's everyday Chrome over CDP. Reuses one shared Browser
   *  connection across panes; adopts the active tab (or opens a new one) and
   *  navigates it to `url`. Throws a precise, actionable error if the endpoint
   *  is unreachable — never a bare stub. */
  private async attach(url: string): Promise<{ context: BrowserContext; page: Page }> {
    // ⚠ RUNTIME: attach must run on NODE, not Bun. `connectOverCDP` speaks CDP
    // over a WebSocket; Bun's WS transport hangs Playwright's connect handshake
    // (verified: raw WS opens 101 on Bun, but connectOverCDP times out; Node
    // connects fine). Managed mode works on Bun because it drives a launched
    // browser over a pipe, not a ws. So the sidecar that serves attach panes is
    // spawned with `node --import tsx`, not `bun run`. See attach.live.ts.
    const endpoint = process.env[ATTACH_ENDPOINT_ENV]?.trim() || DEFAULT_ATTACH_ENDPOINT;

    if (!this.attachBrowser || !this.attachBrowser.isConnected()) {
      try {
        // `connectOverCDP` accepts an http(s) base (probes /json/version for the
        // ws URL) or a ws:// endpoint directly. isLocal+timeout:0 match the
        // settings the official Playwright extension relay uses internally.
        this.attachBrowser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `attach mode could not reach a Chrome CDP endpoint at "${endpoint}" (${detail}).\n` +
            `Start the user's everyday Chrome with remote debugging, e.g.:\n` +
            `  google-chrome --remote-debugging-port=9222 \\\n` +
            `    --user-data-dir="$HOME/.config/google-chrome" \\\n` +
            `    --remote-allow-origins=http://127.0.0.1:9222\n` +
            `(Chrome 136+ also requires --remote-allow-origins for the default profile.)\n` +
            `Override the endpoint with ${ATTACH_ENDPOINT_ENV} (an http base or a ws:// URL — ` +
            `e.g. the official Playwright extension relay's /cdp/<uuid> face).`,
        );
      }
    }

    const browser = this.attachBrowser;
    // Adopt the first existing context (the user's real profile) or, if Chrome
    // exposed none, create one. Then take the active/live tab.
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    await page.goto(url, { waitUntil: 'load' });
    return { context, page };
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
    const { page } = this.requireActive(pane_id);
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

  /** Throw if the pane is paused — mirrors the WebKit engine's pause contract
   *  (snapshot + interaction verbs refuse on a paused pane). */
  private requireActive(pane_id: string): Session {
    const s = this.session(pane_id);
    if (s.paused) throw new Error(`pane ${pane_id} is paused (resume it first)`);
    return s;
  }

  /** Resolve a target spec to a Playwright locator: exactly one of ref / selector
   *  / text, matching the WebKit `require_one_target` semantics. */
  private target(pane_id: string, t: Target, allowText = true): import('playwright').Locator {
    const { page } = this.session(pane_id);
    const set = [t.ref, t.selector, allowText ? t.text : null].filter(Boolean).length;
    if (set !== 1) throw new Error(`exactly one of ref, selector${allowText ? ', text' : ''} is required`);
    if (t.ref) return page.locator(`[data-ik-ref="${t.ref}"]`);
    if (t.selector) return page.locator(t.selector);
    return page.getByText(t.text!).first();
  }

  /** Click — by ref / selector / text. Playwright's actionability/auto-wait does
   *  the heavy lifting. */
  async click(pane_id: string, t: Target): Promise<{ ok: true }> {
    this.requireActive(pane_id);
    await this.target(pane_id, t).click();
    return { ok: true };
  }

  async fill(pane_id: string, t: Target, text: string, replace = true): Promise<{ ok: true }> {
    this.requireActive(pane_id);
    const loc = this.target(pane_id, t, /* allowText */ false);
    if (replace) await loc.fill(text);
    else { await loc.click(); await this.session(pane_id).page.keyboard.type(text); }
    return { ok: true };
  }

  async select(pane_id: string, t: Target, value: string): Promise<{ ok: true }> {
    this.requireActive(pane_id);
    const loc = this.target(pane_id, t, /* allowText */ false);
    await loc.selectOption({ label: value }).catch(() => loc.selectOption(value));
    return { ok: true };
  }

  /** Read the visible text/value of a single target (the WebKit `read_text` verb). */
  async readText(pane_id: string, t: Target): Promise<{ text: string }> {
    this.requireActive(pane_id);
    const loc = this.target(pane_id, t);
    const text = (await loc.textContent()) ?? (await loc.inputValue().catch(() => '')) ?? '';
    return { text: text.trim() };
  }

  async pressKey(pane_id: string, combo: string): Promise<{ ok: true }> {
    this.requireActive(pane_id);
    await this.session(pane_id).page.keyboard.press(combo);
    return { ok: true };
  }

  /** focus (pane) — bring the page to front. The WebKit `/focus` maps here. */
  async focus(pane_id: string): Promise<{ ok: true }> {
    await this.session(pane_id).page.bringToFront().catch(() => {});
    return { ok: true };
  }

  async pause(pane_id: string): Promise<{ ok: true }> {
    this.session(pane_id).paused = true;
    return { ok: true };
  }

  async resume(pane_id: string): Promise<{ ok: true }> {
    this.session(pane_id).paused = false;
    return { ok: true };
  }

  /** eval — honors the IIFE-`return` contract (shell PR #46): the script is a
   *  function body that must `return`, identical on both engines. */
  async eval(pane_id: string, script: string): Promise<unknown> {
    this.requireActive(pane_id);
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
    if (s) {
      // Managed: tear down the dedicated profile context. Attach: only drop our
      // handle — never close the user's real tab/context out from under them.
      if (s.mode === 'managed') await s.context.close().catch(() => {});
      this.sessions.delete(pane_id);
    }
    return { ok: true };
  }

  async list(): Promise<{ panes: Array<{ pane_id: string; current_url: string; mode: Mode; partition: string }> }> {
    const panes = [...this.sessions.entries()].map(([pane_id, s]) => ({
      pane_id, current_url: s.page.url(), mode: s.mode, partition: s.partition,
    }));
    return { panes };
  }

  async shutdown() {
    for (const s of this.sessions.values()) {
      if (s.mode === 'managed') await s.context.close().catch(() => {});
    }
    this.sessions.clear();
    if (this.managedBrowser) await this.managedBrowser.close().catch(() => {});
    // Disconnects the CDP transport only — the user's real Chrome keeps running.
    if (this.attachBrowser) { await this.attachBrowser.close().catch(() => {}); this.attachBrowser = null; }
  }
}
