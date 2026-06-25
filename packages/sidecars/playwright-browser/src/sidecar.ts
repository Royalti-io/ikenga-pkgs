// WP-04 (transport): a localhost HTTP service exposing the Playwright verb engine
// in the EXACT /iyke/browser/* request/response shapes, so the shell bridge can
// reverse-proxy `mode:attach|managed` to it (replacing the in-process chromiumoxide
// dispatch). Runs on NODE (`node --import tsx`) — NOT Bun: Playwright's
// connectOverCDP (attach mode) hangs on Bun's WebSocket transport. The shell
// spawns it as a long-lived sidecar and discovers the port from the
// `IKENGA_PW_READY {port}` stdout line.
//
// Wire shape mirrors the existing bridge: every body carries {pkg_id, pane_id, …};
// responses are the same JSON the chromiumoxide path returned (so @ikenga/mcp-browser
// and the iyke CLI don't change).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { PlaywrightBrowserEngine, type Mode } from './engine.ts';

const engine = new PlaywrightBrowserEngine();

type Body = Record<string, any>;

// Extract the target spec the interaction verbs share. For `click`/`read-text`,
// `text` targets by visible text; for `fill`/`select` the engine ignores `text`
// (there it's the value), so passing it through is harmless.
const target = (b: Body) => ({ ref: b.ref ?? null, selector: b.selector ?? null, text: b.text ?? null });

async function handle(path: string, body: Body): Promise<unknown> {
  const id = body.pane_id as string;
  switch (path) {
    case '/iyke/browser/open':
      return engine.open({ pane_id: id, url: body.url, mode: body.mode as Mode, partition: body.partition });
    case '/iyke/browser/goto': return engine.goto(id, body.url);
    case '/iyke/browser/back': return engine.back(id);
    case '/iyke/browser/forward': return engine.forward(id);
    case '/iyke/browser/reload': return engine.reload(id);
    case '/iyke/browser/snapshot': return engine.snapshot(id, { query: body.query ?? undefined });
    case '/iyke/browser/click': return engine.click(id, target(body));
    case '/iyke/browser/fill': return engine.fill(id, target(body), body.text, body.replace !== false);
    case '/iyke/browser/select': return engine.select(id, target(body), body.value);
    case '/iyke/browser/read-text': return engine.readText(id, target(body));
    case '/iyke/browser/press-key': return engine.pressKey(id, body.combo);
    case '/iyke/browser/eval': return engine.eval(id, body.script);
    case '/iyke/browser/screenshot': return engine.screenshot(id);
    case '/iyke/browser/wait-for': return engine.waitFor(id, body.kind, body.value ?? undefined, body.timeout_ms);
    case '/iyke/browser/focus': return engine.focus(id);
    case '/iyke/browser/pause': return engine.pause(id);
    case '/iyke/browser/resume': return engine.resume(id);
    case '/iyke/browser/close': return engine.close(id);
    default: throw new Error(`unknown verb ${path}`);
  }
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const s = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(s);
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export function serve(port = 0): Server {
  const server = createServer((req, res) => {
    (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/iyke/browser/list' && req.method === 'GET') return sendJson(res, await engine.list());
      if (url.pathname === '/healthz') return sendJson(res, { ok: true });
      if (req.method !== 'POST') return sendJson(res, { error: `method ${req.method} not allowed` }, 405);
      const body = await readBody(req);
      sendJson(res, await handle(url.pathname, body));
    })().catch((e) => sendJson(res, { error: e instanceof Error ? e.message : String(e) }, 500));
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/** Resolve a server's bound port once it's listening. */
export function portOf(server: Server): Promise<number> {
  return new Promise((resolve) => {
    const get = () => { const a = server.address(); resolve(typeof a === 'object' && a ? a.port : 0); };
    if (server.listening) get();
    else server.once('listening', get);
  });
}

// Entry point: start + announce the port for the shell to discover.
const isEntry =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const server = serve(Number(process.env.IKENGA_PW_PORT ?? 0));
  portOf(server).then((port) => console.log(`IKENGA_PW_READY ${port}`));
  const shutdown = async () => { await engine.shutdown(); server.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
