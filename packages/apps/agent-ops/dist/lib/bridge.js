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
// NOTE: we deliberately do NOT import the SDK's applyDocumentTheme /
// applyHostStyleVariables / applyHostFonts helpers. Theme is owned by app.js's
// parent-<html> mirror (the artifact pattern). applyDocumentTheme in particular
// clobbers our workspace `data-theme` (A/B/C) with 'light'|'dark', breaking the
// bundled @ikenga/tokens palette — so the bridge stays out of theming entirely.
import { App } from 'https://esm.sh/@modelcontextprotocol/ext-apps@1.7.1/app-with-deps';

let app = null;

export async function connectBridge({ name, version, onContextChange }) {
  app = new App({ name, version }, {
    // Capabilities the pkg advertises to the host. Keep minimal — declare only
    // what we actually use.
    tools: { listChanged: false },
  });

  app.onerror = (err) => console.error('[agent-ops] bridge error', err);
  // Theme is NOT applied here — app.js mirrors it from the parent <html>.
  // We still forward context so live activeFeature (side-menu) updates reach
  // the app; data flows through host.dbQuery, not the context payload.
  app.onhostcontextchanged = (ctx) => {
    onContextChange?.(ctx);
  };
  app.onteardown = async () => ({});

  await app.connect();
  return app.getHostContext();
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

/** Publish the pkg's sidebar menu to the shell. PkgMode renders these items in
 *  the left side panel when this pkg's pane is focused (normal AppMode). Item
 *  clicks come back as hostContext changes via `royaltiSuite.activeFeature` —
 *  listen via onContextChange in connectBridge.
 *  items: [{ id, label, icon?, badge?, section?, disabled?, active? }] */
export async function setMenu(items) {
  if (!app) throw new Error('bridge not connected');
  return app.callServerTool({
    name: 'host.pkg.setMenu',
    arguments: { items },
  });
}

/**
 * Seed a user turn into the shell's active Claude session.
 *
 *   prompt: string   — the instruction shown as the user turn
 *   source?: string  — provenance tag (defaults to the pkg id)
 */
export async function hostSendToActiveSession(prompt, source = 'com.ikenga.agent-ops') {
  if (!app) throw new Error('bridge not connected');
  return app.callServerTool({
    name: 'host.sendToActiveSession',
    arguments: { prompt, source },
  });
}

/**
 * Read the local `pa.db` via the host's `host.dbQuery` verb.
 * SELECT/WITH only — the shell rejects writes and gates this on the pkg
 * declaring `capabilities.sqlite`. Returns the row array
 * (`structuredContent.rows`); throws on a closed/failed bridge so callers can
 * surface the error in the query layer.
 *
 *   sql:    string         — a single SELECT/WITH statement with `?` params
 *   params: SqlValue[]      — positional bind values
 */
export async function hostDbQuery(sql, params = []) {
  if (!app) throw new Error('[agent-ops] bridge not connected — db_query unavailable');
  const res = await app.callServerTool({
    name: 'host.dbQuery',
    arguments: { sql, params },
  });
  const sc = res?.structuredContent;
  if (!sc || sc.ok !== true) {
    throw new Error(sc?.error ?? res?.content?.[0]?.text ?? 'host.dbQuery failed');
  }
  return Array.isArray(sc.rows) ? sc.rows : [];
}

/**
 * Write to the local `pa.db` via the host's `host.dbExec` verb.
 * INSERT/UPDATE/DELETE only — the shell rejects reads/DDL, gates on the pkg
 * declaring `capabilities.sqlite`, and scopes the target table to the pkg's
 * declared `permissions['sqlite.tables']`. Resolves on success; throws on a
 * closed/failed bridge.
 *
 *   sql:    string         — a single INSERT/UPDATE/DELETE statement with `?` params
 *   params: SqlValue[]      — positional bind values
 */
export async function hostDbExec(sql, params = []) {
  if (!app) throw new Error('[agent-ops] bridge not connected — db_exec unavailable');
  const res = await app.callServerTool({
    name: 'host.dbExec',
    arguments: { sql, params },
  });
  const sc = res?.structuredContent;
  if (!sc || sc.ok !== true) {
    throw new Error(sc?.error ?? res?.content?.[0]?.text ?? 'host.dbExec failed');
  }
}

/** Read the current hostContext snapshot. */
export function getContext() {
  return app?.getHostContext() ?? null;
}

/**
 * List all configured cron jobs + their runtime state via the shell's
 * host.agentOps.listJobs verb (WP-09 adds this host-side; we call it here).
 *
 * Returns the structuredContent payload directly:
 *   { ok: true,  daemon_up, daemon_pid, jobs: RawJob[] }
 * | { ok: false, error: string }
 *
 * Throws if the bridge is not connected (caller should handle).
 */
export async function hostAgentOpsListJobs() {
  if (!app) throw new Error('[agent-ops] bridge not connected — agentOps.listJobs unavailable');
  const res = await app.callServerTool({
    name: 'host.agentOps.listJobs',
    arguments: {},
  });
  const sc = res?.structuredContent;
  if (!sc) {
    throw new Error(res?.content?.[0]?.text ?? 'host.agentOps.listJobs returned no structuredContent');
  }
  // ok:false is a valid application-level response (daemon down, etc.); return it
  // so the query layer can handle gracefully rather than throwing.
  return sc;
}

/** Detect standalone-dev (no parent shell). */
export function isStandalone() {
  return typeof window !== 'undefined' && window.parent === window;
}
