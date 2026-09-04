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
  args: Record<string, unknown> = {},
  // `timeoutMs` is the MCP REQUEST timeout, which is a different budget from
  // the sidecar's own `timeoutSecs` and defaults to 60s in the SDK. Whisper on
  // a real meeting runs far longer than that, so without raising this the
  // transcription is abandoned mid-run with "MCP error -32001: Request timed
  // out" while the work was proceeding perfectly well.
  opts: { timeoutMs?: number } = {}
): Promise<HostCallResult> {
  if (!_app) {
    throw new Error(
      `Meetings needs to run inside the Ikenga shell — ${name} is unavailable in a plain browser tab.`
    );
  }
  const result = (await _app.callServerTool(
    { name, arguments: args },
    opts.timeoutMs ? { timeout: opts.timeoutMs, maxTotalTimeout: opts.timeoutMs } : undefined
  )) as HostCallResult;
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

export const MEETINGS_SIDECAR = 'pa-com-ikenga-meetings-bot';

/**
 * Invoke the meetings sidecar CLI and return its parsed JSON result.
 *
 * `timeoutSecs` matters: transcription of a long meeting runs for minutes and
 * the host's default timeout would abort a perfectly healthy whisper run, so
 * every caller passes a budget matched to the work it is asking for. Both
 * budgets have to move together — the MCP request timeout is a second,
 * shorter one, and whichever is smaller wins.
 */
export async function callSidecar<T = Record<string, unknown>>(
  args: string[],
  opts: { timeoutSecs?: number } = {}
): Promise<T> {
  const res = await callHostTool(
    'host.pkgSidecarCall',
    {
      sidecar: MEETINGS_SIDECAR,
      args,
      ...(opts.timeoutSecs ? { timeoutSecs: opts.timeoutSecs } : {}),
    },
    // Both budgets must be raised together: the host kills the child at
    // `timeoutSecs`, the MCP layer abandons the request at `timeoutMs`.
    // Whichever is shorter wins, so they are derived from the same number.
    opts.timeoutSecs ? { timeoutMs: opts.timeoutSecs * 1000 } : {}
  );

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

// ─── Supervised MCP Tools ──────────────────────────────────────────────────

export interface TranscribeOptions {
  meetingId: string;
  audioPath?: string;
  outputDir?: string;
  model?: string;
  language?: string;
  force?: boolean;
  /** WP-19: which STT backend to use. Defaults to 'local' server-side when
   *  omitted (see `mcp/src/index.ts`). */
  provider?: import('./lib/stt/types.js').SttProviderId;
}

export interface TranscribeResponse {
  ok: boolean;
  meeting_id: string;
  segment_count: number;
  segments: import('@ikenga/meetings-contract').TranscriptSegment[];
  reused_existing_transcript?: boolean;
  error?: string;
}

/**
 * Invoke a tool on this package's own supervised long-lived MCP server.
 * The shell forwards non-`host.` tool calls to `pkg_mcp_call`.
 */
export async function callPkgTool<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  const res = await callHostTool(name, args, opts);
  let payload: unknown = res.structuredContent;
  if (!payload) {
    const text = res.content?.[0]?.text;
    if (!text) throw new Error(`tool ${name} returned no output`);
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`tool ${name} returned non-JSON output: ${text.slice(0, 300)}`);
    }
  }

  const obj = payload as Record<string, unknown>;
  if (obj && obj.ok === false && typeof obj.error === 'string') {
    throw new Error(obj.error);
  }
  return payload as T;
}

/**
 * Transcribe a meeting via the supervised long-lived MCP server (WP-17).
 * Unlike a one-shot CLI dropped by the shell, the MCP server tracks the
 * whisper process directly and terminates it cleanly if the session is dropped.
 */
export async function transcribeMeeting(
  opts: TranscribeOptions | string,
  timeoutSecs = 7200
): Promise<TranscribeResponse> {
  const options: TranscribeOptions = typeof opts === 'string' ? { meetingId: opts } : opts;
  const toolArgs: Record<string, unknown> = {
    meeting_id: options.meetingId,
    ...(options.audioPath ? { audio_path: options.audioPath } : {}),
    ...(options.outputDir ? { output_dir: options.outputDir } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.language ? { language: options.language } : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  };

  return callPkgTool<TranscribeResponse>('transcribe', toolArgs, {
    timeoutMs: timeoutSecs * 1000,
  });
}

// ─── STT provider abstraction (WP-19) ──────────────────────────────────────

export interface EngineAudioCapability {
  available: boolean;
  reason: string;
}

/**
 * Query whether the shell's configured engine can accept audio input, via a
 * `host.engine.capabilities` host tool mirroring
 * `AcpPromptCapabilities.audio` (`@ikenga/contract/engine/acp.ts`).
 *
 * That host tool does not exist yet. As of this writing (2026-09-04)
 * `shell/src/components/pkg/pkg-iframe-host.tsx` implements exactly these
 * `host.*` verbs: `pkgSidecarCall`, `dbQuery`, `dbExec`, `navigate`,
 * `openFolder`, `pkg.setMenu`, `pkg.setBadge`, `paActions.*`, `agentOps.*`,
 * `fetch`, `invoke` — no capability query for the active engine is bridged
 * to pkg iframes at all, and no shipped engine (Claude Code, OpenCode, Pi)
 * advertises `audio: true` regardless — they all wrap text-only CLIs.
 *
 * This still performs a real call rather than hardcoding `false`: any
 * failure (unknown tool today, or a real "no audio support" answer once the
 * bridge exists) is read as unavailable, and the day either gap closes this
 * starts reporting `available: true` with no code change here required.
 */
export async function getEngineAudioCapability(): Promise<EngineAudioCapability> {
  try {
    const res = await callHostTool('host.engine.capabilities', {});
    const payload = (res.structuredContent ?? {}) as { audio?: boolean; engine?: string };
    if (payload.audio === true) {
      return {
        available: true,
        reason: `the configured engine (${payload.engine ?? 'unknown'}) advertises audio input`,
      };
    }
    return {
      available: false,
      reason: payload.engine
        ? `the configured engine (${payload.engine}) does not advertise audio input`
        : 'the configured engine does not advertise audio input',
    };
  } catch {
    return {
      available: false,
      reason:
        "no engine exposes audio input yet — Claude Code, OpenCode and Pi all wrap text-only CLIs, and the shell doesn't bridge engine capabilities to pkgs today",
    };
  }
}

export interface SttStatusResponse {
  ok: boolean;
  local: {
    whisper_binary_available: boolean;
    model_downloaded: boolean;
    reason?: string;
  };
  openai: {
    configured: boolean;
  };
}

/** Ask our own supervised MCP server what it can transcribe with right now:
 *  whether whisper-cli + a model are present locally, and whether an OpenAI
 *  key has been configured (never the key's value — see `mcp/src/tools.ts`). */
export async function sttStatus(): Promise<SttStatusResponse> {
  return callPkgTool<SttStatusResponse>('stt_status');
}

/** Store the user's OpenAI API key for this pkg (see `mcp/src/secrets-store.ts`
 *  for exactly where and why). The key is sent once, over this pkg's own
 *  supervised MCP connection, and is never returned, logged, or persisted in
 *  this iframe. */
export async function setOpenAiApiKey(apiKey: string): Promise<void> {
  await callPkgTool('stt_set_openai_key', { api_key: apiKey });
}

export async function clearOpenAiApiKey(): Promise<void> {
  await callPkgTool('stt_clear_openai_key');
}

