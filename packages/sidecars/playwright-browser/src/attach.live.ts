// Live ATTACH test — manual (needs a real Chrome). NOT in the CI suite.
//
//   bun run src/attach.live.ts
//
// Proves the attach mechanism end-to-end: it launches a throwaway-profile Chrome
// with --remote-debugging-port, then drives engine.open({mode:'attach'}) against
// it via connectOverCDP and runs the verb contract on the adopted tab.
//
// To test against YOUR EVERYDAY, logged-in Chrome instead (the real use case):
//   1. Fully quit Chrome.
//   2. Launch it with the debug port on your real profile:
//        google-chrome --remote-debugging-port=9222 \
//          --user-data-dir="$HOME/.config/google-chrome" \
//          --remote-allow-origins=http://127.0.0.1:9222
//   3. Run this with SKIP_LAUNCH=1 so it attaches to YOUR Chrome instead of
//      launching its own:  SKIP_LAUNCH=1 bun run src/attach.live.ts
//      Then point step 5 at a site you're logged into and confirm the snapshot
//      shows your authenticated state.
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { PlaywrightBrowserEngine } from './engine.ts';

const PORT = Number(process.env.ATTACH_PORT ?? 9222);
const CHROME = process.env.CHROME_BIN ?? '/usr/bin/google-chrome-stable';
const PROFILE = path.join(os.tmpdir(), 'ikenga-attach-live');
const FIX = path.join(os.tmpdir(), `ik-attach-${process.pid}.html`);
writeFileSync(FIX, `<!doctype html><meta charset=utf-8><title>Attach Live</title><body>
<button id=go aria-label="Run action">Run action</button><output id=out>idle</output>
<script>document.getElementById('go').addEventListener('click',()=>{document.getElementById('out').textContent='clicked';});</script>
</body>`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let chrome: ChildProcess | undefined;
let fails = 0;
const ok = (n: string, c: boolean, m: string) => { if (!c) fails++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${n.padEnd(10)} ${m}`); };

async function main() {
  if (process.env.SKIP_LAUNCH !== '1') {
    console.log(`launching debug Chrome on :${PORT} (throwaway profile ${PROFILE})…`);
    chrome = spawn(CHROME, [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      `--remote-allow-origins=http://127.0.0.1:${PORT}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check',
      'about:blank',
    ], { stdio: 'ignore', detached: false });
  } else {
    console.log(`SKIP_LAUNCH=1 — attaching to the Chrome you already have on :${PORT}`);
  }

  // wait for CDP
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {}
    await sleep(500);
  }

  process.env.IKENGA_PW_ATTACH_ENDPOINT = `http://127.0.0.1:${PORT}`;
  const eng = new PlaywrightBrowserEngine();
  try {
    const opened = await eng.open({ pane_id: 'a1', url: 'file://' + FIX, mode: 'attach' });
    ok('attach', opened.mode === 'attach', `connected over CDP + adopted a tab (${JSON.stringify(opened)})`);

    const snap = await eng.snapshot('a1');
    const btn = snap.nodes.find((n) => n.role === 'button' || n.tag === 'button');
    ok('snapshot', !!btn, `title="${snap.title}" button-ref=${btn?.ref}`);

    await eng.click('a1', { ref: btn!.ref });
    const out = await eng.eval('a1', `return document.getElementById('out').textContent`);
    ok('click', out === 'clicked', `#out=${JSON.stringify(out)}`);

    ok('eval', (await eng.eval('a1', `return 2+2`)) === 4, 'eval IIFE-return');

    const shot = await eng.screenshot('a1');
    ok('screenshot', shot.bytes > 1000, `${shot.bytes} bytes`);

    // close() on an attach pane must only DISCONNECT — never kill the user's Chrome
    await eng.close('a1');
    const stillUp = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false);
    ok('safe-close', stillUp, 'pane closed but Chrome still alive (never kills the user browser)');

    console.log(`\nRESULT: ${fails === 0 ? 'PASS' : 'FAIL'} — ${6 - fails}/6 attach checks`);
  } finally {
    await eng.shutdown();
    if (chrome) chrome.kill('SIGKILL');
  }
  process.exit(fails === 0 ? 0 : 1);
}
main();
