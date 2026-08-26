// com.ikenga.git · iframe ↔ host bridge (WP-06)
//
// The MCP Apps SDK (`@modelcontextprotocol/ext-apps`) is the canonical
// iframe⇄host protocol the shell speaks (shell/src/components/pkg/
// pkg-iframe-host.tsx). After `connectBridge()` resolves we have a
// `hostContext` with theme/mode/density and a `royaltiSuite` namespace
// (activeFeature, activeProject). We call back into the host via
// `app.callServerTool({ name: 'host.*', ... })`.
//
// Per D11 (01-plan.md §Decisions): this pkg's UI uses NO `host.fetch` /
// `host.invoke`. The only host verbs it reaches are `host.pkg.setMenu` and
// `host.pkgSidecarCall` (§0 of rpc.ts) — both audited below, nothing else.
//
// Standalone mode (no parent window, e.g. `pnpm dev` in a bare tab) resolves
// immediately with `mode: 'standalone'`; callers branch off that rather than
// re-checking `window.parent === window` everywhere.

import { App } from '@modelcontextprotocol/ext-apps';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

import type { GitHostContext } from './host-context';
import { ONESHOT_ARGV, RpcRequestSchema, SIDECAR_NAME, type RpcResponse } from './rpc';
import { MOCK_PROJECT_ROOT, setMockRoot, type MockRootKey } from '../mock/mock-sidecar';

/** Standalone dev only: synthesize `royaltiSuite.activeProject` from
 *  `?scan=<key>` so every G-05 state (and the DELTA-3 not-a-repo-but-nested
 *  case) can be exercised from a bare browser tab, without a shell. Mirrors
 *  MOCK_ROOTS' keys (mock/mock-sidecar.ts) — `?scan=workspace` (default)
 *  shows the happy path, `?scan=noProject` / `noProjectRoot` short-circuit
 *  before the sidecar is even asked, the rest go through `setMockRoot`. Only
 *  relevant when `transport.ts` is ALSO using the mock (true whenever
 *  standalone), so this never affects a real shell mount. */
function standaloneHostContext(): GitHostContext {
  let scanKey = 'workspace';
  try {
    scanKey = new URLSearchParams(window.location.search).get('scan') ?? 'workspace';
  } catch {
    // ignore — default to the happy path
  }
  if (scanKey === 'noProject') {
    return { royaltiSuite: {} };
  }
  if (scanKey === 'noProjectRoot') {
    return { royaltiSuite: { activeProject: { id: 'mock', name: 'Mock project', root: null } } };
  }
  setMockRoot(scanKey as MockRootKey);
  return {
    royaltiSuite: {
      activeProject: { id: 'mock', name: 'ikenga (mock)', root: MOCK_PROJECT_ROOT },
    },
  };
}

export interface BridgeConnection {
  mode: 'shell' | 'standalone';
  hostContext: GitHostContext | undefined;
}

let _app: App | null = null;
let _connection: BridgeConnection | null = null;
let _connectionPromise: Promise<BridgeConnection> | null = null;
const _contextListeners = new Set<(ctx: GitHostContext) => void>();
const _repoChangedListeners = new Set<(params: unknown) => void>();

export function isStandalone(): boolean {
  return typeof window === 'undefined' || window.parent === window;
}

/** Connect to the host and resolve once the initial context handshake is
 *  complete. Idempotent — a second call returns the same promise. */
export function connectBridge(
  opts: { name?: string; version?: string } = {}
): Promise<BridgeConnection> {
  if (_connectionPromise) return _connectionPromise;

  if (isStandalone()) {
    const connection: BridgeConnection = { mode: 'standalone', hostContext: standaloneHostContext() };
    _connection = connection;
    _connectionPromise = Promise.resolve(connection);
    return _connectionPromise;
  }

  const name = opts.name ?? '@ikenga/pkg-git';
  const version = opts.version ?? '0.1.0';

  _connectionPromise = (async () => {
    const app = new App({ name, version }, { tools: { listChanged: false } });

    app.onerror = (err: unknown) => {
      // Never throw out of the iframe boot — surface to devtools, keep the
      // pane up so at least the boot placeholder / last-good state stays.
      // eslint-disable-next-line no-console
      console.error('[git] bridge error', err);
    };

    app.onhostcontextchanged = (ctx: unknown) => {
      const typed = ctx as GitHostContext;
      for (const fn of _contextListeners) fn(typed);
    };

    app.onteardown = async () => ({});

    // WP-05's MCP is the D7 push source: its watcher emits ONE `repo.changed`
    // notification per coalesced window as a `notifications/message` frame,
    // which the shell's supervisor relay forwards verbatim (rpc.ts §5.1 /
    // §0(b)). Register before connect() so no early frame is missed — mirrors
    // com.ikenga.studio's `LoggingMessageNotificationSchema` wiring.
    app.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      const data = (n.params as { data?: unknown } | undefined)?.data as
        | { method?: unknown; params?: unknown }
        | undefined;
      if (!data || data.method !== 'repo.changed') return;
      for (const fn of _repoChangedListeners) fn(data.params);
    });

    await app.connect();
    const ctx = app.getHostContext() as GitHostContext | undefined;

    _app = app;
    const connection: BridgeConnection = { mode: 'shell', hostContext: ctx };
    _connection = connection;
    return connection;
  })();

  return _connectionPromise;
}

/** Subscribe to hostContext changes (theme flips, activeFeature clicks,
 *  activeProject switches). Returns an unsubscribe fn. */
export function onHostContextChange(fn: (ctx: GitHostContext) => void): () => void {
  _contextListeners.add(fn);
  return () => _contextListeners.delete(fn);
}

/** Subscribe to a relayed `repo.changed` notification. Returns an unsubscribe
 *  fn. Never fires in standalone mode. */
export function onRepoChanged(fn: (params: unknown) => void): () => void {
  _repoChangedListeners.add(fn);
  return () => _repoChangedListeners.delete(fn);
}

/** Synchronous read of the most recent hostContext. `undefined` before
 *  `connectBridge()` resolves and in standalone mode. */
export function getHostContext(): GitHostContext | undefined {
  return _connection?.hostContext ?? undefined;
}

interface HostCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

async function callHostTool(name: string, args: Record<string, unknown> = {}): Promise<HostCallResult> {
  if (!_app) throw new Error(`[git] callHostTool(${name}) before connectBridge() resolved`);
  return (await _app.callServerTool({ name, arguments: args })) as HostCallResult;
}

/** A published sidebar-menu item. Mirrors the shell's `PkgMenuItem`
 *  (shell/src/lib/pkg/pkg-menu-store.ts) 1:1. */
export interface PublishedMenuItem {
  id: string;
  label: string;
  icon?: string | null;
  badge?: string | number | null;
  subtitle?: string | null;
  section?: string | null;
  disabled?: boolean;
  active?: boolean;
  kind?: 'item' | 'seg';
  options?: Array<{ id: string; label: string; active?: boolean }>;
}

/** Publish the pkg's sidebar menu. Click feedback arrives back through
 *  `hostContext.royaltiSuite.activeFeature` on the next `onhostcontextchanged`. */
export function setMenu(items: PublishedMenuItem[]): Promise<HostCallResult> {
  return callHostTool('host.pkg.setMenu', { items });
}

/** Sync the pane's own URL to the given sub-route path (agent-ops deep-link
 *  pattern, memory `reference_pkg_subroute_deeplinks`). Same-source sub-route
 *  changes do NOT remount the iframe — this is a pure history update so a
 *  persisted pane restores on the right view. */
export function hostNavigate(path: string): Promise<HostCallResult> {
  return callHostTool('host.navigate', { path });
}

/**
 * One-shot RPC call over `host.pkgSidecarCall` (rpc.ts §0(a)) — the ONLY
 * sidecar verb a pkg iframe can reach. Every call spawns a fresh sidecar
 * process, writes `stdin`, reads `stdout`, and exits; there is no cache on
 * this path (WP-04's problem, not the UI's).
 *
 * This throws on a transport failure (bridge not connected, timeout,
 * malformed stdout) — callers distinguish that from an in-band `{ok:false,
 * reason}` result, which this function does NOT unwrap.
 */
export async function pkgSidecarCall(request: unknown): Promise<RpcResponse> {
  const parsed = RpcRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Error(`[git] pkgSidecarCall: malformed request — ${parsed.error.message}`);
  }
  const res = await callHostTool('host.pkgSidecarCall', {
    sidecar: SIDECAR_NAME,
    args: [...ONESHOT_ARGV],
    stdin: JSON.stringify(parsed.data),
    timeoutSecs: 20,
  });
  if (res.isError) {
    const text = res.content?.find((c) => c.type === 'text')?.text ?? 'host.pkgSidecarCall failed';
    throw new Error(`[git] pkgSidecarCall: ${text}`);
  }
  return res.structuredContent as RpcResponse;
}
