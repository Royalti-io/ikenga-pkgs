// com.ikenga.meetings · iframe ↔ host bridge
//
// The shell speaks the MCP Apps SDK protocol to pkg iframes (see
// shell/src/components/pkg/pkg-iframe-host.tsx). After `connectBridge()`
// resolves we can reach the host's `host.*` tools via `callServerTool`.
//
// Three host verbs matter to this pkg:
//
//   host.dbQuery       — SELECT/WITH against ikenga.db, scoped to the tables
//                        declared in manifest `permissions["sqlite.tables"]`.
//   host.dbExec        — INSERT/UPDATE/DELETE, same table scope.
//   host.pkgSidecarCall— one-shot invocation of our own declared sidecar.
//
// Standalone degradation: opened in a plain browser tab (`pnpm dev`) there is
// no parent window, so `connectBridge()` resolves in `standalone` mode and the
// callers below surface a clear "needs the shell" error rather than hanging on
// a handshake that will never complete.
import { App, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';

export type BridgeMode = 'shell' | 'standalone';

export interface BridgeConnection {
  mode: BridgeMode;
  hostContext: McpUiHostContext | undefined;
}

interface HostCallResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

let _app: App | undefined;
let _connection: BridgeConnection | undefined;
let _connectionPromise: Promise<BridgeConnection> | undefined;

export function isStandalone(): boolean {
  return typeof window === 'undefined' || window.parent === window;
}

/** Connect to the host; idempotent. */
export function connectBridge(): Promise<BridgeConnection> {
  if (_connectionPromise) return _connectionPromise;

  if (isStandalone()) {
    const connection: BridgeConnection = { mode: 'standalone', hostContext: undefined };
    _connection = connection;
    _connectionPromise = Promise.resolve(connection);
    return _connectionPromise;
  }

  _connectionPromise = (async () => {
    const app = new App(
      { name: '@ikenga/meetings', version: '0.1.0' },
      { tools: { listChanged: false } }
    );

    app.onerror = (err: unknown) => {
      // Never throw out of iframe boot — a bridge error should degrade the
      // pane to an error banner, not a blank rectangle.
      console.error('[meetings] bridge error', err);
    };
    app.onteardown = async () => ({});

    await app.connect();
    _app = app;
    const connection: BridgeConnection = {
      mode: 'shell',
      hostContext: app.getHostContext(),
    };
    _connection = connection;
    return connection;
  })();

  return _connectionPromise;
}

export function bridgeMode(): BridgeMode | undefined {
  return _connection?.mode;
}

async function callHostTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<HostCallResult> {
  if (!_app) {
    throw new Error(
      `Meetings needs to run inside the Ikenga shell — ${name} is unavailable in a plain browser tab.`
    );
  }
  const result = (await _app.callServerTool({ name, arguments: args })) as HostCallResult;
  if (result.isError) {
    throw new Error(result.content?.[0]?.text ?? `${name} failed`);
  }
  return result;
}

// ─── SQL ───────────────────────────────────────────────────────────────────
//
// Shaped to satisfy `SqlExecutor` from @ikenga/meetings-contract, so the whole
// `MeetingsDbClient` query layer works unchanged against the real ikenga.db.

export const hostSqlExecutor = {
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await callHostTool('host.dbQuery', { sql, params });
    // The shell returns the result set as `structuredContent.rows`; the text
    // leg is only a human summary ("3 row(s)") and carries no data. So there
    // is deliberately NO text fallback here: parsing that string would yield
    // an empty array and make a broken read look like an empty table, which
    // reads to the user as "my meetings vanished".
    const rows = res.structuredContent?.rows;
    if (!Array.isArray(rows)) {
      throw new Error('host.dbQuery returned no row set');
    }
    return rows as T[];
  },

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await callHostTool('host.dbExec', { sql, params });
  },
};

// ─── Sidecar ───────────────────────────────────────────────────────────────

export const MEETINGS_SIDECAR = 'pa-meetings-bot';

/**
 * Invoke the meetings sidecar CLI and return its parsed JSON result.
 *
 * `timeoutSecs` matters: transcription of a long meeting runs for minutes and
 * the host's default timeout would abort a perfectly healthy whisper run, so
 * every caller passes a budget matched to the work it is asking for.
 */
export async function callSidecar<T = Record<string, unknown>>(
  args: string[],
  opts: { timeoutSecs?: number } = {}
): Promise<T> {
  const res = await callHostTool('host.pkgSidecarCall', {
    sidecar: MEETINGS_SIDECAR,
    args,
    ...(opts.timeoutSecs ? { timeoutSecs: opts.timeoutSecs } : {}),
  });

  let payload: unknown = res.structuredContent;
  if (!payload) {
    const text = res.content?.[0]?.text;
    if (!text) throw new Error(`sidecar ${args[0]} returned no output`);
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`sidecar ${args[0]} returned non-JSON output: ${text.slice(0, 300)}`);
    }
  }

  // The CLI reports its own failures as `{ok:false, error}` with a non-zero
  // exit rather than by crashing, so the structured error has to be unwrapped
  // here — otherwise a failed start would read as a successful one.
  const obj = payload as Record<string, unknown>;
  if (obj && obj.ok === false && typeof obj.error === 'string') {
    throw new Error(obj.error);
  }
  return payload as T;
}
