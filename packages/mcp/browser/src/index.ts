#!/usr/bin/env node
//
// browser-mcp — Model Context Protocol server that lets agents drive
// native child webviews in the running Ikenga desktop app. Wraps the
// shell's `/iyke/browser/*` HTTP bridge with bearer-token auth read from
// the same `control.json` the Iyke MCP and CLI use.
//
// Pane addressing: the agent gets opaque ids `b1, b2, ...`. The server
// translates them to the shell's `(pkg_id, pane_id)` shape internally
// — pkg_id is always this server's own manifest id, pane_id is the bN.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { BROWSER_WAIT_FOR_KINDS } from '@ikenga/contract/browser';

import { BrowserClient } from './api.js';
import { load, STALE_THRESHOLD_SECS } from './control.js';

const PKG_ID = 'com.ikenga.mcp-browser';
const DEFAULT_RECT = { x: 0, y: 0, w: 1024, h: 768 };
const DEFAULT_PARTITION = 'default';

/** Allocator + map for opaque `bN` ids. Wiped on server restart. */
const panes = {
  next: 1,
  known: new Set<string>(),
  allocate(): string {
    const id = `b${this.next++}`;
    this.known.add(id);
    return id;
  },
  release(id: string): void {
    this.known.delete(id);
  },
  has(id: string): boolean {
    return this.known.has(id);
  },
};

const TOOLS = [
  {
    name: 'browser_open',
    description:
      'Open a new child-webview pane navigated to `url`. Returns an opaque pane id like `b1` that all subsequent browser_* tools use to address this pane. Pass either `session` (a name from browser_session_list) OR `partition` (a raw jar slug) — mutually exclusive. Omit both to use the default jar. Pane survives until browser_close or the desktop app restarts.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full https:// URL to load.' },
        partition: { type: 'string', description: 'Raw cookie/storage jar slug. Mutually exclusive with `session`.' },
        session: { type: 'string', description: 'Named session handle (from browser_session_create). Resolves to a partition.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_close',
    description: 'Close a pane by id. The cookie partition on disk is preserved — a future browser_open with the same partition name picks up the same logins/state.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Pane id from browser_open.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_list',
    description: 'List all currently-open browser panes owned by this MCP server. Returns { panes: [{id, url, partition, surface_kind}] }. Useful to discover what state a previous session left around.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_focus',
    description: 'Bring a pane to front (best-effort). NOTE: shell-side focus is a no-op on v1; this tool returns ok for forward-compat but does not currently move OS-level focus. Use iyke_focus from the iyke MCP if you need to focus a shell pane.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_goto',
    description: 'Navigate an existing pane to a new URL. Wait for the page to settle by following up with browser_wait_for { kind: "idle" }.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['id', 'url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_back',
    description: 'Navigate the pane back one entry in its history.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_forward',
    description: 'Navigate the pane forward one entry in its history.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the pane.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Take an accessibility-tree snapshot of a pane. Returns Playwright-style indented `text` plus structured `nodes` with stable `ref` ids (e0, e1, …). Pass a ref to browser_click / browser_fill / browser_select / browser_press_key / browser_read_text. Refs invalidate on the next snapshot or any navigation. `query` filters role/name/value; `all=true` includes hidden + aria-hidden elements.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        query: { type: 'string', description: 'Substring filter (case-insensitive).' },
        all: { type: 'boolean', description: 'Include hidden elements.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_read_text',
    description: 'Read the visible text of a single element by ref. Use this instead of a full snapshot when you only need one value.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ref: { type: 'string', description: 'Ref from a prior snapshot.' },
      },
      required: ['id', 'ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_screenshot',
    description: 'NOT YET IMPLEMENTED (Phase 4+). Returns 501. Use iyke_screenshot on a shell pane in the meantime if you need a screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        out_path: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element. Specify exactly one of `ref` (from a snapshot, most reliable), `selector` (CSS), or `text` (innerText substring match against clickable elements).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ref: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_fill',
    description: 'Type text into an input/textarea/contenteditable. Specify exactly one of `ref` or `selector`. `replace=true` overwrites; default appends.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ref: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        replace: { type: 'boolean' },
      },
      required: ['id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_select',
    description: 'Pick an option in a <select>. `value` matches the option `value` attribute, label, or visible text. Specify exactly one of `ref` or `selector`.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ref: { type: 'string' },
        selector: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['id', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_press_key',
    description: 'Dispatch a keyboard combo. Names: "Enter", "Escape", "Tab", "ArrowDown", etc. Modifiers Ctrl/Alt/Shift/Meta separated by + or , (e.g. "Ctrl+S", "Meta+K"). Optional ref/selector targets a specific element; otherwise the active element receives.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        combo: { type: 'string' },
        ref: { type: 'string' },
        selector: { type: 'string' },
      },
      required: ['id', 'combo'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_wait_for',
    description:
      'Wait until a predicate is satisfied or timeout. Use after browser_click / browser_goto instead of fixed sleeps. `kind`: "url" (substring match against location.href), "text" / "gone-text" (substring match / no-match against page text), "selector" / "gone-selector" (CSS selector matches / no longer matches), "ref" (re-snapshot until ref appears), "idle" (readyState=complete + 250ms of mutation silence). `value` required for all except "idle". Returns { satisfied, elapsed_ms, message? }.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        kind: { type: 'string', enum: [...BROWSER_WAIT_FOR_KINDS] },
        value: { type: 'string' },
        timeout_ms: { type: 'integer', minimum: 100, maximum: 60000, default: 10000 },
      },
      required: ['id', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_eval',
    description:
      'Escape hatch: evaluate a JS expression in the pane and return its result. The expression body must end in an explicit `return` (it runs inside an IIFE). Stay away from this for anything a snapshot+click can do — refs are more reliable.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        script: { type: 'string' },
      },
      required: ['id', 'script'],
      additionalProperties: false,
    },
  },
  // ── Named sessions (Phase 4) ─────────────────────────────────────────────
  {
    name: 'browser_session_create',
    description:
      'Create a named session: a human-friendly handle for a cookie/storage partition. Pass `name` (e.g. "spotify-main"). If `partition` is omitted, it is derived from `name` (sanitized: lowercase, non-alphanum → "-"). Use the session in browser_open via the `session` field to keep multiple accounts isolated under stable, memorable names.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Friendly handle, 1–64 chars.' },
        partition: { type: 'string', description: 'Optional explicit partition slug.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_session_list',
    description:
      'List named sessions owned by this MCP server. Returns { sessions: [{ name, partition, created_at, last_used_at }] }, ordered by most-recently-used.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_session_delete',
    description:
      'Delete a session by name. NOTE: the underlying cookie partition data on disk is preserved — re-creating a session with the same partition slug picks the cookies back up. Use this when you want to retire a name without losing the logins.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  // ── Pause / resume (Phase 5) ─────────────────────────────────────────────
  {
    name: 'browser_pause',
    description:
      'Pause a pane: snapshot / interaction tools (snapshot, click, fill, select, press_key, read_text, wait_for, eval) refuse with HTTP 409 until resumed. Navigation (goto/back/forward/reload), lifecycle (close), and list still work — the pane stays interactive for the human user. Use this when an agent flow hits something it should not automate past (e.g. a captcha, a "are you sure?" dialog, an MFA prompt).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_resume',
    description: 'Resume a paused pane (clears the pause flag). Idempotent: resuming an already-unpaused pane is fine.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
] as const;

type ToolName = (typeof TOOLS)[number]['name'];

function getClient(): BrowserClient {
  const outcome = load();
  switch (outcome.kind) {
    case 'ok':
      return new BrowserClient(outcome.control);
    case 'missing':
      throw new McpError(
        ErrorCode.InternalError,
        'Ikenga desktop app does not appear to be running (no control.json found).',
      );
    case 'stale-removed':
      throw new McpError(
        ErrorCode.InternalError,
        'Ikenga desktop app does not appear to be running (cleared a stale control.json from a previous launch).',
      );
    case 'stale-young':
      throw new McpError(
        ErrorCode.InternalError,
        `control.json exists but its PID is dead and the file is only ${outcome.ageSecs}s old (threshold ${STALE_THRESHOLD_SECS}s). The app may be launching or in a startup race; retry shortly.`,
      );
  }
}

function requireKnown(id: unknown): string {
  if (typeof id !== 'string' || !/^b[1-9]\d*$/.test(id)) {
    throw new McpError(ErrorCode.InvalidParams, `invalid pane id: ${JSON.stringify(id)}`);
  }
  if (!panes.has(id)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `unknown pane id ${id}. Call browser_list to see open panes or browser_open to create one.`,
    );
  }
  return id;
}

async function dispatch(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
  const client = getClient();

  switch (name) {
    case 'browser_open': {
      if (args.partition && args.session) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'pass at most one of `partition` / `session`',
        );
      }
      // Resolve named session → partition before opening. This also bumps
      // last_used_at on the shell side so list-by-recent stays accurate.
      let partition = typeof args.partition === 'string' ? args.partition : DEFAULT_PARTITION;
      if (typeof args.session === 'string' && args.session.length > 0) {
        const resolved = (await client.post('/iyke/browser/session/resolve', {
          pkg_id: PKG_ID,
          name: args.session,
        })) as { partition: string };
        partition = resolved.partition;
      }
      const id = panes.allocate();
      try {
        await client.post('/iyke/browser/open', {
          pkg_id: PKG_ID,
          pane_id: id,
          url: args.url,
          partition,
          rect: DEFAULT_RECT,
        });
        return { id, url: args.url, partition, session: args.session ?? null };
      } catch (e) {
        panes.release(id);
        throw e;
      }
    }

    case 'browser_session_create': {
      return client.post('/iyke/browser/session/create', {
        pkg_id: PKG_ID,
        name: args.name,
        partition: typeof args.partition === 'string' ? args.partition : null,
      });
    }

    case 'browser_session_list': {
      return client.get('/iyke/browser/session/list', { pkg_id: PKG_ID });
    }

    case 'browser_session_delete': {
      return client.post('/iyke/browser/session/delete', {
        pkg_id: PKG_ID,
        name: args.name,
      });
    }

    case 'browser_pause': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/pause', { pkg_id: PKG_ID, pane_id: id });
    }

    case 'browser_resume': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/resume', { pkg_id: PKG_ID, pane_id: id });
    }

    case 'browser_close': {
      const id = requireKnown(args.id);
      const res = await client.post('/iyke/browser/close', { pkg_id: PKG_ID, pane_id: id });
      panes.release(id);
      return res;
    }

    case 'browser_list': {
      const res = (await client.get('/iyke/browser/list', { pkg_id: PKG_ID })) as {
        panes: Array<{ pane_id: string; current_url: string | null; partition: string; surface_kind: string }>;
      };
      // Reconcile the local known set with whatever the shell reports.
      const seen = new Set(res.panes.map((p) => p.pane_id));
      for (const known of [...panes.known]) {
        if (!seen.has(known)) panes.release(known);
      }
      for (const p of res.panes) panes.known.add(p.pane_id);
      return {
        panes: res.panes.map((p) => ({
          id: p.pane_id,
          url: p.current_url,
          partition: p.partition,
          surface_kind: p.surface_kind,
        })),
      };
    }

    case 'browser_focus': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/focus', { pkg_id: PKG_ID, pane_id: id });
    }

    case 'browser_goto': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/goto', { pkg_id: PKG_ID, pane_id: id, url: args.url });
    }

    case 'browser_back': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/back', { pkg_id: PKG_ID, pane_id: id });
    }
    case 'browser_forward': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/forward', { pkg_id: PKG_ID, pane_id: id });
    }
    case 'browser_reload': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/reload', { pkg_id: PKG_ID, pane_id: id });
    }

    case 'browser_snapshot': {
      const id = requireKnown(args.id);
      return client.post(
        '/iyke/browser/snapshot',
        {
          pkg_id: PKG_ID,
          pane_id: id,
          query: args.query ?? null,
          all: args.all === true,
        },
        15_000,
      );
    }

    case 'browser_read_text': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/read-text', {
        pkg_id: PKG_ID,
        pane_id: id,
        ref: args.ref,
      });
    }

    case 'browser_screenshot': {
      // Server returns 501; we still validate the id so the agent gets a
      // consistent error shape rather than HTTP noise.
      requireKnown(args.id);
      throw new McpError(
        ErrorCode.InternalError,
        'browser_screenshot is not implemented yet (Phase 4+). Use iyke_screenshot on a shell pane in the meantime.',
      );
    }

    case 'browser_click': {
      const id = requireKnown(args.id);
      requireOneTarget(args);
      return client.post('/iyke/browser/click', {
        pkg_id: PKG_ID,
        pane_id: id,
        ref: args.ref ?? null,
        selector: args.selector ?? null,
        text: args.text ?? null,
      });
    }

    case 'browser_fill': {
      const id = requireKnown(args.id);
      requireOneTarget(args, /* allowText */ false);
      return client.post('/iyke/browser/fill', {
        pkg_id: PKG_ID,
        pane_id: id,
        ref: args.ref ?? null,
        selector: args.selector ?? null,
        text: args.text,
        replace: args.replace === true,
      });
    }

    case 'browser_select': {
      const id = requireKnown(args.id);
      requireOneTarget(args, /* allowText */ false);
      return client.post('/iyke/browser/select', {
        pkg_id: PKG_ID,
        pane_id: id,
        ref: args.ref ?? null,
        selector: args.selector ?? null,
        value: args.value,
      });
    }

    case 'browser_press_key': {
      const id = requireKnown(args.id);
      return client.post('/iyke/browser/press-key', {
        pkg_id: PKG_ID,
        pane_id: id,
        combo: args.combo,
        ref: args.ref ?? null,
        selector: args.selector ?? null,
      });
    }

    case 'browser_wait_for': {
      const id = requireKnown(args.id);
      const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : 10_000;
      return client.post(
        '/iyke/browser/wait-for',
        {
          pkg_id: PKG_ID,
          pane_id: id,
          kind: args.kind,
          value: args.value ?? null,
          timeout_ms: timeoutMs,
        },
        timeoutMs + 3_000,
      );
    }

    case 'browser_eval': {
      const id = requireKnown(args.id);
      return client.post(
        '/iyke/browser/eval',
        {
          pkg_id: PKG_ID,
          pane_id: id,
          script: args.script,
        },
        30_000,
      );
    }
  }
}

function requireOneTarget(args: Record<string, unknown>, allowText = true): void {
  const count =
    (args.ref ? 1 : 0) + (args.selector ? 1 : 0) + (allowText && args.text ? 1 : 0);
  if (count !== 1) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `must set exactly one of: ref, selector${allowText ? ', text' : ''}`,
    );
  }
}

async function main(): Promise<void> {
  const server = new Server(
    { name: 'browser-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (!TOOLS.some((t) => t.name === name)) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    try {
      const result = await dispatch(name as ToolName, (args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      if (err instanceof McpError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: msg }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('browser-mcp fatal:', err);
  process.exit(1);
});
