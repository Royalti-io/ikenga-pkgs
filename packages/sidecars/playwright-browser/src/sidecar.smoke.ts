// WP-04 transport smoke: start the sidecar HTTP service and drive the full
// /iyke/browser/* surface over HTTP (the exact shape the shell bridge proxies).
// Run: IKENGA_PW_HEADLESS=1 bun run src/sidecar.smoke.ts
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { serve, portOf } from './sidecar.ts';

const FIX = path.join(os.tmpdir(), `ik-pw-sc-${process.pid}.html`);
writeFileSync(FIX, `<!doctype html><meta charset=utf-8><title>Sidecar Fixture</title><body>
<button id=go aria-label="Run action">Run action</button>
<input id=q name=q type=text aria-label="Search query">
<output id=out>idle</output>
<script>document.getElementById('go').addEventListener('click',()=>{document.getElementById('out').textContent='clicked';});</script>
</body>`);

const server = serve(0);
const PORT = await portOf(server);
const base = `http://127.0.0.1:${PORT}`;
const PKG = 'com.ikenga.mcp-browser', PANE = 'p1';
let fails = 0;
const ok = (name: string, cond: boolean, msg: string) => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name.padEnd(11)} ${msg}`); };
const post = (p: string, b: object) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pkg_id: PKG, pane_id: PANE, ...b }) }).then((r) => r.json());
const get = (p: string) => fetch(base + p + `?pkg_id=${PKG}`).then((r) => r.json());

try {
  const opened = await post('/iyke/browser/open', { url: 'file://' + FIX, mode: 'managed' });
  ok('open', opened.mode === 'managed' && opened.pane_id === PANE, JSON.stringify(opened));

  const snap = await post('/iyke/browser/snapshot', {});
  const btn = snap.nodes?.find((n: any) => n.role === 'button' || n.tag === 'button');
  const inp = snap.nodes?.find((n: any) => n.tag === 'input');
  ok('snapshot', !!btn && !!inp && /^e\d+$/.test(btn.ref), `title="${snap.title}" btn=${btn?.ref} inp=${inp?.ref}`);

  await post('/iyke/browser/click', { ref: btn.ref });
  const out = await post('/iyke/browser/eval', { script: `return document.getElementById('out').textContent` });
  ok('click+eval', out === 'clicked', `#out=${JSON.stringify(out)}`);

  await post('/iyke/browser/fill', { ref: inp.ref, text: 'hello sidecar' });
  const q = await post('/iyke/browser/eval', { script: `return document.getElementById('q').value` });
  ok('fill', q === 'hello sidecar', `#q=${JSON.stringify(q)}`);

  const shot = await post('/iyke/browser/screenshot', {});
  ok('screenshot', shot.bytes > 1000 && typeof shot.base64 === 'string', `${shot.bytes} bytes`);

  const list = await get('/iyke/browser/list');
  ok('list', list.panes?.length === 1 && list.panes[0].pane_id === PANE, `${list.panes?.length} pane(s)`);

  await post('/iyke/browser/close', {});
  const list2 = await get('/iyke/browser/list');
  ok('close', list2.panes?.length === 0, `${list2.panes?.length} pane(s) after close`);

  console.log(`\nRESULT: ${fails === 0 ? 'PASS' : 'FAIL'} — ${6 - fails}/6 verbs over HTTP (port ${PORT})`);
} finally {
  server.close();
}
process.exit(fails === 0 ? 0 : 1);
