// WP-04 (transport): a localhost HTTP service exposing the Playwright verb engine
// in the EXACT /iyke/browser/* request/response shapes, so the shell bridge can
// reverse-proxy `mode:attach|managed` to it (replacing the in-process chromiumoxide
// dispatch). Runs on Bun (Bun.serve). The shell spawns it as a long-lived sidecar
// and discovers the port from the `IKENGA_PW_READY {port}` stdout line.
//
// Wire shape mirrors the existing bridge: every body carries {pkg_id, pane_id, …};
// responses are the same JSON the chromiumoxide path returned (so @ikenga/mcp-browser
// and the iyke CLI don't change).

import { PlaywrightBrowserEngine, type Mode } from './engine.ts';

const engine = new PlaywrightBrowserEngine();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const err = (e: unknown, status = 500) =>
  json({ error: e instanceof Error ? e.message : String(e) }, status);

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

export function serve(port = 0) {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      try {
        if (url.pathname === '/iyke/browser/list' && req.method === 'GET') return json(await engine.list());
        if (url.pathname === '/healthz') return json({ ok: true });
        if (req.method !== 'POST') return err(`method ${req.method} not allowed`, 405);
        const body = (await req.json().catch(() => ({}))) as Body;
        return json(await handle(url.pathname, body));
      } catch (e) {
        return err(e);
      }
    },
  });
}

// Entry point: start + announce the port for the shell to discover.
if (import.meta.main) {
  const server = serve(Number(process.env.IKENGA_PW_PORT ?? 0));
  // eslint-disable-next-line no-console
  console.log(`IKENGA_PW_READY ${server.port}`);
  const shutdown = async () => { await engine.shutdown(); server.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
