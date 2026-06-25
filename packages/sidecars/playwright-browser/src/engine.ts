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
import fs from 'node:fs';
import { spawn } from 'node:child_process';

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
  /** attach mode only: which Chrome target to drive.
   *  "new"    = open a fresh tab (context.newPage()), non-invasive — DEFAULT.
   *  "active" = adopt the first open tab (legacy behavior).
   *  "<id>"   = adopt the page whose CDP target id / url matches.
   *  In every case the page is navigated only if `url` is a non-empty,
   *  non-about:blank value. */
  attach_target?: AttachTarget;
}

/** "new" | "active" | a CDP target id (any other string). */
export type AttachTarget = 'new' | 'active' | (string & {});

const DEFAULT_PARTITION = 'default';
const DEFAULT_ATTACH_TARGET: AttachTarget = 'new';

/** OS Chrome profile, enumerated from the user-data-dir's Local State. */
export interface ChromeProfile {
  dir: string;
  name: string;
  running: boolean;
}

/** A live CDP target (window/tab) on a running debug Chrome. */
export interface ChromeCdpTarget {
  targetId: string;
  title: string;
  url: string;
  kind: string;
}

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
      // attach: connect over CDP to the user's everyday Chrome and adopt a tab
      // (new / active / a specific target) as this pane's page, so every
      // downstream verb (snapshot/click/fill/eval/screenshot via data-ik-ref)
      // works unchanged.
      ({ context, page } = await this.attach(input.url, input.attach_target ?? DEFAULT_ATTACH_TARGET));
    }

    this.sessions.set(input.pane_id, { context, page, mode, partition, paused: false });
    return { pane_id: input.pane_id, url: input.url, mode, partition };
  }

  /** Attach to the user's everyday Chrome over CDP. Reuses one shared Browser
   *  connection across panes; the `target` selects which tab to drive (new /
   *  active / a specific CDP target id or url). The page is navigated only when
   *  `url` is meaningful (non-empty and not about:blank), so the default "new"
   *  path never hijacks an existing tab. Throws a precise, actionable error if
   *  the endpoint is unreachable — never a bare stub. */
  private async attach(
    url: string,
    target: AttachTarget = DEFAULT_ATTACH_TARGET,
  ): Promise<{ context: BrowserContext; page: Page }> {
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
    // exposed none, create one.
    const context = browser.contexts()[0] ?? (await browser.newContext());

    let page: Page;
    if (target === 'new') {
      // Least invasive: a fresh tab. Never touches the user's existing tabs.
      page = await context.newPage();
    } else if (target === 'active') {
      // Legacy behavior: adopt the first live tab.
      page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    } else {
      // Adopt a specific tab. Match by CDP target id first (queried out-of-band
      // via /json so we don't need a private Playwright API), then fall back to
      // an exact url match; finally to a substring url match.
      const pages = context.pages().filter((p) => !p.isClosed());
      const urlForTarget = await this.urlForTargetId(target);
      page =
        (urlForTarget ? pages.find((p) => p.url() === urlForTarget) : undefined) ??
        pages.find((p) => p.url() === target) ??
        pages.find((p) => p.url().includes(target)) ??
        undefined!;
      if (!page) {
        throw new Error(
          `attach_target "${target}" did not match any open tab. ` +
            `Call GET /iyke/browser/targets for the current target ids / urls.`,
        );
      }
    }

    // Navigate only when the caller actually asked for a url. A blank/about:blank
    // url means "drive whatever is there" and must not disturb the tab.
    if (this.shouldNavigate(url)) await page.goto(url, { waitUntil: 'load' });
    return { context, page };
  }

  /** Resolve a CDP target id to its url via the raw `/json` listing, so the
   *  "<id>" attach path can match a Playwright Page (whose CDP id isn't exposed
   *  by the public API). Returns undefined if it can't be resolved. */
  private async urlForTargetId(targetId: string): Promise<string | undefined> {
    try {
      const { targets } = await this.targets();
      return targets.find((t) => t.targetId === targetId)?.url;
    } catch {
      return undefined;
    }
  }

  /** A url worth navigating to: present and not the blank page. */
  private shouldNavigate(url: string | undefined): boolean {
    const u = (url ?? '').trim();
    return u.length > 0 && u !== 'about:blank';
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

  // ─── Profiles / targets / launch (WP-1 + WP-3) ──────────────────────────
  // These are chrome-only *global* queries — no pane/session involved. They
  // back the FE picker: list on-disk profiles, list live debug-Chrome tabs,
  // and launch a chosen profile into debug mode so it becomes attachable.

  /** The OS-correct Chrome user-data-dir (where "Local State" + profile dirs
   *  live). Overridable with IKENGA_PW_CHROME_DATA_DIR for tests / non-default
   *  installs. */
  private chromeDataDir(): string {
    const override = process.env.IKENGA_PW_CHROME_DATA_DIR?.trim();
    if (override) return override;
    const home = os.homedir();
    switch (process.platform) {
      case 'darwin':
        return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
      case 'win32':
        return path.join(
          process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
          'Google',
          'Chrome',
          'User Data',
        );
      default:
        return path.join(home, '.config', 'google-chrome');
    }
  }

  /** WP-1: enumerate OS Chrome profiles from Local State → profile.info_cache.
   *  `running` is best-effort (a SingletonLock present in the profile dir). This
   *  is distinct from the Ikenga named partitions used by managed mode. */
  async profiles(): Promise<{ profiles: ChromeProfile[] }> {
    const dataDir = this.chromeDataDir();
    let infoCache: Record<string, { name?: string }> = {};
    try {
      const raw = fs.readFileSync(path.join(dataDir, 'Local State'), 'utf8');
      const parsed = JSON.parse(raw) as { profile?: { info_cache?: Record<string, { name?: string }> } };
      infoCache = parsed.profile?.info_cache ?? {};
    } catch {
      // No Local State (Chrome never run / not installed) → no profiles.
      return { profiles: [] };
    }
    const profiles = Object.entries(infoCache).map(([dir, info]) => ({
      dir,
      name: (info?.name ?? dir).trim() || dir,
      running: this.profileRunning(dataDir, dir),
    }));
    return { profiles };
  }

  /** Best-effort: is this profile currently open? Chrome holds a SingletonLock
   *  in the profile directory while running. Symlink on Linux/mac, file on Win;
   *  presence either way is the signal. */
  private profileRunning(dataDir: string, dir: string): boolean {
    try {
      fs.lstatSync(path.join(dataDir, dir, 'SingletonLock'));
      return true;
    } catch {
      return false;
    }
  }

  /** The attach CDP endpoint (env override or the default port). */
  private attachEndpoint(): string {
    return process.env[ATTACH_ENDPOINT_ENV]?.trim() || DEFAULT_ATTACH_ENDPOINT;
  }

  /** WP-1: probe the attach endpoint for live tabs. Never throws — if no debug
   *  Chrome is reachable, returns `{ endpoint: null, targets: [] }` so the FE
   *  can show the "start Chrome with --remote-debugging-port" hint. */
  async targets(): Promise<{ endpoint: string | null; targets: ChromeCdpTarget[] }> {
    const endpoint = this.attachEndpoint();
    try {
      // /json/version is the liveness probe; /json is the tab list.
      const version = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!version.ok) return { endpoint: null, targets: [] };
      const listRes = await fetch(`${endpoint}/json`, { signal: AbortSignal.timeout(2_000) });
      if (!listRes.ok) return { endpoint, targets: [] };
      const raw = (await listRes.json()) as Array<{
        id?: string;
        title?: string;
        url?: string;
        type?: string;
      }>;
      const targets = (Array.isArray(raw) ? raw : [])
        .filter((t) => (t.type ?? 'page') === 'page')
        .map((t) => ({
          targetId: t.id ?? '',
          title: t.title ?? '',
          url: t.url ?? '',
          kind: t.type ?? 'page',
        }));
      return { endpoint, targets };
    } catch {
      return { endpoint: null, targets: [] };
    }
  }

  /** Resolve the installed Chrome ('chrome' channel) executable. Playwright's
   *  public `executablePath()` only points at its bundled Chromium, so we
   *  resolve the real Chrome by the platform's well-known install locations
   *  (first existing wins). Overridable with IKENGA_PW_CHROME_BINARY. */
  private chromeExecutable(): string {
    const override = process.env.IKENGA_PW_CHROME_BINARY?.trim();
    if (override) return override;
    const candidates =
      process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : process.platform === 'win32'
          ? [
              path.join(
                process.env['PROGRAMFILES'] ?? 'C:\\Program Files',
                'Google',
                'Chrome',
                'Application',
                'chrome.exe',
              ),
              path.join(
                process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
                'Google',
                'Chrome',
                'Application',
                'chrome.exe',
              ),
            ]
          : [
              '/usr/bin/google-chrome',
              '/usr/bin/google-chrome-stable',
              '/opt/google/chrome/chrome',
              '/usr/bin/chromium',
              '/usr/bin/chromium-browser',
            ];
    for (const c of candidates) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch {
        // try next
      }
    }
    // Last resort: the bundled Chromium. Honors the contract ("the installed
    // Chrome … or the 'chrome' channel") as a graceful fallback rather than a
    // hard failure when Chrome isn't at a standard path.
    return chromium.executablePath();
  }

  /** WP-3: launch the installed Chrome on a chosen on-disk profile in debug
   *  mode so it becomes attachable. Refuses if that profile is already running
   *  (Chrome's singleton would just focus the existing window and ignore the
   *  debug flags). Returns the endpoint once the CDP port answers. */
  async launchProfile(input: { dir: string; port?: number }): Promise<{ ok: true; endpoint: string }> {
    const dir = input.dir;
    const port = input.port ?? 9222;
    const dataDir = this.chromeDataDir();

    if (this.profileRunning(dataDir, dir)) {
      throw new Error(
        `Chrome profile "${dir}" is already running. Quit it first, or attach to it ` +
          `if it was started with --remote-debugging-port. (A running profile holds a ` +
          `SingletonLock; relaunching just focuses the existing window and ignores the ` +
          `debug flags.)`,
      );
    }

    const exe = this.chromeExecutable();
    const endpoint = `http://127.0.0.1:${port}`;
    const args = [
      `--profile-directory=${dir}`,
      `--remote-debugging-port=${port}`,
      `--remote-allow-origins=${endpoint}`,
      `--user-data-dir=${dataDir}`,
    ];
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();

    // Wait for the CDP port to come up (bounded). The first /json/version 200
    // means it's attachable.
    const deadline = Date.now() + 15_000;
    let lastErr = '';
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) });
        if (res.ok) return { ok: true, endpoint };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(
      `Launched Chrome for profile "${dir}" but its CDP endpoint at ${endpoint} never ` +
        `came up within 15s${lastErr ? ` (last: ${lastErr})` : ''}.`,
    );
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
