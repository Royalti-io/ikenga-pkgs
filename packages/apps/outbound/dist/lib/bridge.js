// MCP Apps SDK bridge — the canonical iframe⇄host protocol Ikenga uses.
// Copied verbatim from mail/dist/lib/bridge.js and rebranded for com.ikenga.outbound.
//
// Pattern from @modelcontextprotocol/ext-apps Quickstart + the shell's
// pkg-iframe-host.tsx implementation:
//   1. new App(...) — register handlers before connect
//   2. await app.connect() — runs ui/initialize handshake automatically
//   3. app.getHostContext() — read theme / styles / supabase / royaltiAuth
//   4. app.callServerTool({ name: 'host.<x>', arguments }) — invoke host tools
//
// NOTE: we deliberately do NOT import the SDK's applyDocumentTheme /
// applyHostStyleVariables / applyHostFonts helpers. Theme is owned by app.js's
// parent-<html> mirror (the artifact pattern). applyDocumentTheme in particular
// clobbers our workspace `data-theme` (A/B/C) with 'light'|'dark', breaking the
// bundled @ikenga/tokens palette.
import { App } from 'https://esm.sh/@modelcontextprotocol/ext-apps@1.7.1/app-with-deps';

let app = null;

export async function connectBridge({ name, version, onContextChange }) {
  app = new App({ name, version }, {
    tools: { listChanged: false },
  });

  app.onerror = (err) => console.error('[outbound] bridge error', err);
  app.onhostcontextchanged = (ctx) => {
    onContextChange?.(ctx);
  };
  app.onteardown = async () => ({});

  await app.connect();
  return app.getHostContext();
}

/** Navigate the focused shell pane. */
export async function hostNavigate(path) {
  if (!app) throw new Error('bridge not connected');
  return app.callServerTool({ name: 'host.navigate', arguments: { path } });
}

/** Publish the pkg's sidebar menu to the shell. */
export async function setMenu(items) {
  if (!app) throw new Error('bridge not connected');
  return app.callServerTool({ name: 'host.pkg.setMenu', arguments: { items } });
}

/**
 * Read the local `ikenga.db` via the host's `host.dbQuery` verb.
 * SELECT/WITH only — parameterised (`?` placeholders).
 */
export async function hostDbQuery(sql, params = []) {
  if (!app) throw new Error('[outbound] bridge not connected — db_query unavailable');
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
 * Write to the local `ikenga.db` via the host's `host.dbExec` verb.
 * INSERT/UPDATE/DELETE only.
 */
export async function hostDbExec(sql, params = []) {
  if (!app) throw new Error('[outbound] bridge not connected — db_exec unavailable');
  const res = await app.callServerTool({
    name: 'host.dbExec',
    arguments: { sql, params },
  });
  const sc = res?.structuredContent;
  if (!sc || sc.ok !== true) {
    throw new Error(sc?.error ?? res?.content?.[0]?.text ?? 'host.dbExec failed');
  }
}

// ── Approve-gate verbs (host.paActions*) — the folded approve-gate write path. ──
// Strategy B (plans/outbound-pkg/01-plan.md §G-PAACTIONS): four thin verbs the
// shell wraps over the existing, tested `pa_actions_*` Rust commands, gated by
// the pkg declaring `capabilities.paActions === true`. The pkg never gets raw
// write access to pa_action_drafts — commit/event/wake/normalization stay
// shell-owned. Each verb operates on the pa_action_drafts row `id` (NOT a legacy
// table id) and resolves only when structuredContent.ok === true.

async function callPaAction(verb, args) {
  if (!app) throw new Error(`[outbound] bridge not connected — host.paActions.${verb} unavailable`);
  const res = await app.callServerTool({
    name: `host.paActions.${verb}`,
    arguments: args,
  });
  const sc = res?.structuredContent;
  if (!sc || sc.ok !== true) {
    throw new Error(sc?.error ?? res?.content?.[0]?.text ?? `host.paActions.${verb} failed`);
  }
  return sc;
}

/** Commit an approved draft → worker sends it for real. */
export async function hostPaActionsCommit(draftId) {
  return callPaAction('commit', { draftId });
}

/** Reject a draft (will not send). */
export async function hostPaActionsReject(draftId) {
  return callPaAction('reject', { draftId });
}

/** Retry a failed draft (failed → committed; clears claim/error + wakes worker). */
export async function hostPaActionsRetry(draftId) {
  return callPaAction('retry', { draftId });
}

/** Edit-in-place: patch a draft's subject/body (writes edited_json, awaiting→edited). */
export async function hostPaActionsUpdate(draftId, patch) {
  return callPaAction('update', { draftId, patch });
}

/** Seed a user turn into the shell's active Claude session. */
export async function hostSendToActiveSession(prompt, source = 'com.ikenga.outbound') {
  if (!app) throw new Error('bridge not connected');
  return app.callServerTool({
    name: 'host.sendToActiveSession',
    arguments: { prompt, source },
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

/**
 * Publish a key/value into the shell's iyke iframe-state registry.
 * Fire-and-forget; no-ops standalone.
 */
export function publishIykeState(key, value) {
  if (isStandalone()) return;
  try {
    window.parent.postMessage({ __iyke: true, kind: 'state', payload: { key, value } }, '*');
  } catch {
    /* never let debug-surface publishing break the app */
  }
}
