// WP-03 conformance: drive the Playwright engine through the verb contract
// (managed mode — autonomous, no extension). Mirrors the chrome-pkg smoke's
// interaction gates so WP-05 can re-point that smoke at this backend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
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
    await eng.click('p1', btn!.ref);
    const out = await eng.eval('p1', `return document.getElementById('out').textContent`);
    assert.equal(out, 'clicked', 'click mutated #out');

    // fill via ref -> value set
    await eng.fill('p1', inp!.ref, 'hello engine');
    const q = await eng.eval('p1', `return document.getElementById('q').value`);
    assert.equal(q, 'hello engine', 'fill set #q');

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

    // attach mode errors cleanly (until WP-02 wires the extension)
    await assert.rejects(eng.open({ pane_id: 'p2', url: 'about:blank', mode: 'attach' }), /extension/);
  } finally {
    await eng.shutdown();
  }
});
