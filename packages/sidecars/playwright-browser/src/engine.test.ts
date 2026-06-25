// WP-03 conformance: drive the Playwright engine through the verb contract
// (managed mode — autonomous, no extension). Mirrors the chrome-pkg smoke's
// interaction gates so WP-05 can re-point that smoke at this backend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PlaywrightBrowserEngine } from './engine.ts';

const FIX = path.join(os.tmpdir(), `ik-pw-fixture-${process.pid}.html`);
writeFileSync(FIX, `<!doctype html><meta charset=utf-8><title>Engine Fixture</title><body>
<h1 id=h>engine</h1>
<button id=go aria-label="Run action">Run action</button>
<input id=q name=q type=text aria-label="Search query">
<output id=out>idle</output>
<script>document.getElementById('go').addEventListener('click',()=>{document.getElementById('out').textContent='clicked';});</script>
</body>`);

test('Playwright engine satisfies the /iyke/browser/* verb contract (managed)', async () => {
  const eng = new PlaywrightBrowserEngine();
  try {
    // open
    const opened = await eng.open({ pane_id: 'p1', url: 'file://' + FIX, mode: 'managed' });
    assert.equal(opened.mode, 'managed');

    // snapshot -> refs
    const snap = await eng.snapshot('p1');
    assert.equal(snap.title, 'Engine Fixture');
    const btn = snap.nodes.find((n) => n.role === 'button' || n.tag === 'button');
    const inp = snap.nodes.find((n) => n.tag === 'input');
    assert.ok(btn, 'snapshot found a button ref');
    assert.ok(inp, 'snapshot found an input ref');
    assert.match(btn!.ref, /^e\d+$/);

    // click via ref -> page mutates
    await eng.click('p1', { ref: btn!.ref });
    const out = await eng.eval('p1', `return document.getElementById('out').textContent`);
    assert.equal(out, 'clicked', 'click mutated #out');

    // click via text target also works (selector/text parity with webkit)
    await eng.eval('p1', `return document.getElementById('out').textContent = 'idle'`);
    await eng.click('p1', { text: 'Run action' });
    assert.equal(await eng.eval('p1', `return document.getElementById('out').textContent`), 'clicked', 'click-by-text works');

    // fill via ref -> value set
    await eng.fill('p1', { ref: inp!.ref }, 'hello engine');
    const q = await eng.eval('p1', `return document.getElementById('q').value`);
    assert.equal(q, 'hello engine', 'fill set #q');

    // read-text + pause/resume contract
    assert.equal((await eng.readText('p1', { ref: btn!.ref })).text, 'Run action', 'read-text by ref');
    await eng.pause('p1');
    await assert.rejects(eng.click('p1', { ref: btn!.ref }), /paused/, 'paused refuses interaction');
    await eng.resume('p1');
    await eng.click('p1', { ref: btn!.ref }); // works again

    // eval (IIFE-return contract)
    assert.equal(await eng.eval('p1', `return 6*7`), 42);

    // screenshot
    const shot = await eng.screenshot('p1');
    assert.ok(shot.bytes > 1000, `screenshot produced ${shot.bytes} bytes`);
    assert.ok(shot.base64.length > 0);

    // list
    const list = await eng.list();
    assert.equal(list.panes.length, 1);
    assert.equal(list.panes[0]!.pane_id, 'p1');

    // close
    await eng.close('p1');
    assert.equal((await eng.list()).panes.length, 0);

    // attach mode connects over CDP; with no Chrome remote-debugging endpoint
    // reachable it must fail with a precise, actionable error (not a bare stub).
    process.env.IKENGA_PW_ATTACH_ENDPOINT = 'http://127.0.0.1:59999'; // nothing listening
    await assert.rejects(
      eng.open({ pane_id: 'p2', url: 'about:blank', mode: 'attach' }),
      /attach mode could not reach a Chrome CDP endpoint/,
    );
    delete process.env.IKENGA_PW_ATTACH_ENDPOINT;
  } finally {
    await eng.shutdown();
  }
});

// WP-1: profiles() reads the OS Chrome user-data-dir's Local State and maps
// profile.info_cache (dir → display name), with best-effort `running`.
test('profiles() parses Local State info_cache into {dir,name,running}', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ik-chrome-data-'));
  writeFileSync(
    path.join(dataDir, 'Local State'),
    JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: 'Chinedum' },
          'Profile 1': { name: 'Chinedum' },
          'Profile 3': { name: 'KODE' },
        },
      },
    }),
  );
  // Mark "Profile 3" as running via a SingletonLock in its dir.
  mkdirSync(path.join(dataDir, 'Profile 3'), { recursive: true });
  writeFileSync(path.join(dataDir, 'Profile 3', 'SingletonLock'), '');

  process.env.IKENGA_PW_CHROME_DATA_DIR = dataDir;
  try {
    const eng = new PlaywrightBrowserEngine();
    const { profiles } = await eng.profiles();
    assert.equal(profiles.length, 3, 'three profiles parsed');
    const kode = profiles.find((p) => p.dir === 'Profile 3');
    assert.ok(kode, 'Profile 3 present');
    assert.equal(kode!.name, 'KODE', 'display name from info_cache');
    assert.equal(kode!.running, true, 'SingletonLock → running');
    const def = profiles.find((p) => p.dir === 'Default');
    assert.equal(def!.name, 'Chinedum');
    assert.equal(def!.running, false, 'no lock → not running');
  } finally {
    delete process.env.IKENGA_PW_CHROME_DATA_DIR;
  }
});

// profiles() returns [] (no throw) when Local State is absent.
test('profiles() returns [] when no Local State exists', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ik-chrome-empty-'));
  process.env.IKENGA_PW_CHROME_DATA_DIR = dataDir;
  try {
    const { profiles } = await new PlaywrightBrowserEngine().profiles();
    assert.deepEqual(profiles, []);
  } finally {
    delete process.env.IKENGA_PW_CHROME_DATA_DIR;
  }
});

// WP-1: targets() never throws when no debug Chrome is reachable — it returns
// the endpoint:null sentinel the FE uses to show the debug-port hint.
test('targets() returns {endpoint:null,targets:[]} when no debug Chrome is up', async () => {
  process.env.IKENGA_PW_ATTACH_ENDPOINT = 'http://127.0.0.1:59998'; // nothing listening
  try {
    const out = await new PlaywrightBrowserEngine().targets();
    assert.equal(out.endpoint, null);
    assert.deepEqual(out.targets, []);
  } finally {
    delete process.env.IKENGA_PW_ATTACH_ENDPOINT;
  }
});

// targets() maps a live /json listing (page targets only) to the wire shape.
test('targets() maps a live /json listing to {targetId,title,url,kind}', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/json/version') return res.end(JSON.stringify({ Browser: 'Chrome/136' }));
    if (req.url === '/json')
      return res.end(
        JSON.stringify([
          { id: 'T-1', title: 'Tab One', url: 'https://a.example/', type: 'page' },
          { id: 'SW', title: 'sw', url: 'https://a.example/sw.js', type: 'service_worker' },
        ]),
      );
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  process.env.IKENGA_PW_ATTACH_ENDPOINT = `http://127.0.0.1:${port}`;
  try {
    const out = await new PlaywrightBrowserEngine().targets();
    assert.equal(out.endpoint, `http://127.0.0.1:${port}`);
    assert.equal(out.targets.length, 1, 'only page targets, sw filtered');
    assert.deepEqual(out.targets[0], {
      targetId: 'T-1',
      title: 'Tab One',
      url: 'https://a.example/',
      kind: 'page',
    });
  } finally {
    delete process.env.IKENGA_PW_ATTACH_ENDPOINT;
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// WP-2: attach_target defaults to "new" — a fresh tab — and (when no url is
// supplied) does NOT navigate any existing tab. We assert this against a mock
// CDP+page surface by connecting to a local CDP-shaped HTTP server and proving
// that the "new" path calls context.newPage() and never page.goto() on tab 0.
// Playwright's connectOverCDP can't talk to a hand-rolled mock, so we exercise
// the decision directly via the (small) public surface: a managed page whose
// goto we can observe is the wrong fixture here; instead we assert the
// navigate-gating logic that governs every attach path.
test('attach navigate-gating: blank/about:blank urls do not trigger navigation', () => {
  const eng = new PlaywrightBrowserEngine() as unknown as {
    shouldNavigate(u: string | undefined): boolean;
  };
  assert.equal(eng.shouldNavigate(''), false, 'empty url → no nav');
  assert.equal(eng.shouldNavigate('   '), false, 'whitespace url → no nav');
  assert.equal(eng.shouldNavigate(undefined), false, 'undefined url → no nav');
  assert.equal(eng.shouldNavigate('about:blank'), false, 'about:blank → no nav');
  assert.equal(eng.shouldNavigate('https://x.example/'), true, 'real url → nav');
});
