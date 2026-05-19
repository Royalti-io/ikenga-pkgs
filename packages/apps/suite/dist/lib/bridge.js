// MCP Apps SDK bridge — the canonical iframe⇄host protocol Ikenga uses.
//
// Pattern from @modelcontextprotocol/ext-apps Quickstart + the shell's
// pkg-iframe-host.tsx implementation:
//   1. new App(...) — register handlers before connect
//   2. await app.connect() — runs ui/initialize handshake automatically
//   3. app.getHostContext() — read theme / styles / supabase / royaltiAuth
//   4. app.callServerTool({ name: 'host.<x>', arguments }) — invoke host tools
//      (shell intercepts `host.*` names in dispatchHostCall; everything else
//      proxies to pkg MCP servers if any).
//
// The host re-emits hostContext on theme change via onhostcontextchanged.

// Use the bundled `app-with-deps` build — the default entry pulls
// `zod/v4` as a peer-via-esm.sh and dependency resolution sometimes
// produces a Zod build missing `.custom()`. The bundled variant
// inlines its deps so it works regardless of esm.sh's resolver state.
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from 'https://esm.sh/@modelcontextprotocol/ext-apps@1.7.1/app-with-deps';

let app = null;

export async function connectBridge({ name, version, onContextChange }) {
  app = new App({ name, version }, {
    // Capabilities the pkg advertises to the host. Keep minimal — declare only
    // what we actually use.
    tools: { listChanged: false },
  });

  app.onerror = (err) => console.error('[suite] bridge error', err);
  app.onhostcontextchanged = (ctx) => {
    applyContext(ctx);
    onContextChange?.(ctx);
  };
  app.onteardown = async () => ({});

  await app.connect();
  const ctx = app.getHostContext();
  if (ctx) applyContext(ctx);
  return ctx;
}

function applyContext(ctx) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx?.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

/** Navigate the focused shell pane (cross-pkg or in-pkg sub-route). */
export async function hostNavigate(path) {
  if (!app) throw new Error('bridge not connected');
  return app.callServerTool({
    name: 'host.navigate',
    arguments: { path },
  });
}

/** Open an external link via the host. */
export async function openLink(url) {
  if (!app) throw new Error('bridge not connected');
  return app.openLink({ url });
}

/** Publish the pkg's current sidebar menu to the shell. The shell renders
 *  these items in its left side panel when the focused pane is this pkg's
 *  route. Item clicks come back as hostContext changes via
 *  `royaltiSuite.activeFeature` — listen via onContextChange in connectBridge.
 *
 *  items: [{ id, label, icon?, badge? }]
 */
export async function setMenu(items) {
  if (!app) throw new Error('bridge not connected');
  return app.callServerTool({
    name: 'host.pkg.setMenu',
    arguments: { items },
  });
}

/** Read the current hostContext snapshot. */
export function getContext() {
  return app?.getHostContext() ?? null;
}

/** Detect standalone-dev (no parent shell). */
export function isStandalone() {
  return typeof window !== 'undefined' && window.parent === window;
}
