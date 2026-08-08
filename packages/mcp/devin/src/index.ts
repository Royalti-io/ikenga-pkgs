#!/usr/bin/env node
//
// devin-mcp — Model Context Protocol server that exposes the user's local
// Devin CLI to any Ikenga engine. Spawns `devin` child processes in response
// to MCP `tools/call` requests and returns stdout as MCP text content.
//

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { devinStatus } from './devin.js';
import { delegateTask, getTask, cancelTask, listTasks } from './ledger.js';

const PKG_ID = 'com.ikenga.mcp-devin';

const TOOLS = [
  {
    name: 'devin_status',
    description:
      'Check whether the Devin CLI is installed and authenticated. Returns one of: not_installed, not_authenticated, ready.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'devin_run',
    description:
      'Run a single Devin prompt via `devin -p` and return its stdout. Use with care: `mode` defaults to "auto"; "dangerous" auto-approves all tools and is unsafe for untrusted prompts; "smart" uses a fast model to judge safety.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to send to Devin.' },
        cwd: { type: 'string', description: 'Working directory. Defaults to the workspace root.' },
        mode: {
          type: 'string',
          enum: ['auto', 'accept-edits', 'smart', 'dangerous'],
          description: 'Devin --permission-mode. Default: "auto". "dangerous" auto-approves all tools; "smart" uses a fast model to judge safety.',
        },
        model: { type: 'string', description: 'Devin model short name, e.g. "swe" or "opus".' },
        timeout_seconds: {
          type: 'number',
          description: 'Timeout in seconds, clamped to [5, 900]. Default 120.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'devin_list_sessions',
    description:
      'List Devin sessions that can be resumed. Equivalent to the Devin session-list / resume command.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        limit: { type: 'number', description: 'Max sessions to return, clamped to [1, 100]. Default 20.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'devin_resume',
    description:
      'Resume an existing Devin session with a follow-up prompt. Session id format is whatever Devin CLI expects — treated as opaque here.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Devin session id or resume key.' },
        prompt: { type: 'string', description: 'Follow-up prompt.' },
        cwd: { type: 'string' },
        mode: {
          type: 'string',
          enum: ['auto', 'accept-edits', 'smart', 'dangerous'],
          description: 'Devin --permission-mode. Default: "auto". "dangerous" auto-approves all tools.',
        },
        model: { type: 'string' },
        timeout_seconds: {
          type: 'number',
          description: 'Timeout in seconds, clamped to [5, 900]. Default 120.',
        },
      },
      required: ['session_id', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'devin_delegate',
    description:
      'Start a long-running Devin task in the background and return a task_id. The task runs until completion, cancellation, auth failure, or timeout. Output is streamed to disk and can be polled with devin_delegate_status.',
    inputSchema: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'Self-contained prompt for Devin.' },
        cwd: { type: 'string' },
        mode: {
          type: 'string',
          enum: ['auto', 'accept-edits', 'smart', 'dangerous'],
          description: 'Devin --permission-mode. Default: "auto". "dangerous" auto-approves all tools.',
        },
        model: { type: 'string' },
        session_id: { type: 'string', description: 'Resume an existing Devin session if provided.' },
        attach_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths to thread through to Devin. Non-absolute paths are rejected.',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Timeout in seconds, clamped to [30, 7200]. Default 900.',
        },
      },
      required: ['brief'],
      additionalProperties: false,
    },
  },
  {
    name: 'devin_delegate_status',
    description:
      'Poll the status of a background Devin task by task_id. Returns running, awaiting_auth, done, failed, cancelled, or timed_out. Output is a tail-truncated snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Opaque task id from devin_delegate.' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'devin_delegate_cancel',
    description:
      'Cancel a running background Devin task by task_id. Returns an error if the task is not owned by this sidecar process.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: 'devin-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'devin_status': {
      const status = await devinStatus();
      return {
        content: [{ type: 'text', text: status.kind }],
        isError: status.kind !== 'ready',
        _meta: { version: 'version' in status ? status.version : undefined },
      };
    }

    case 'devin_run': {
      // One-shot: delegate and wait. Exposed separately so callers can fire a
      // quick synchronous run without polling. Backed by the same ledger.
      const result = await delegateTask({
        brief: String(a.prompt ?? a.brief ?? ''),
        cwd: a.cwd ? String(a.cwd) : undefined,
        mode: a.mode ? String(a.mode) : undefined,
        model: a.model ? String(a.model) : undefined,
        session_id: a.session_id ? String(a.session_id) : undefined,
        timeout_seconds: typeof a.timeout_seconds === 'number' ? a.timeout_seconds : undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: result.status === 'failed',
      };
    }

    case 'devin_list_sessions': {
      const records = listTasks().map((r) => ({
        task_id: r.task_id,
        status: r.status,
        brief: r.brief.slice(0, 120),
        started_at: r.started_at,
        ended_at: r.ended_at,
        chi_run_id: r.chi_run_id,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(records) }],
      };
    }

    case 'devin_resume': {
      // Resume means delegating again with a session_id that points to an
      // existing Devin session.
      const session_id = a.session_id ? String(a.session_id) : undefined;
      if (!session_id) {
        return { content: [{ type: 'text', text: 'session_id required for devin_resume' }], isError: true };
      }
      const result = await delegateTask({
        brief: String(a.prompt ?? a.brief ?? ''),
        cwd: a.cwd ? String(a.cwd) : undefined,
        session_id,
        mode: a.mode ? String(a.mode) : undefined,
        model: a.model ? String(a.model) : undefined,
        timeout_seconds: typeof a.timeout_seconds === 'number' ? a.timeout_seconds : undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: result.status === 'failed',
      };
    }

    case 'devin_delegate': {
      const result = await delegateTask({
        brief: String(a.brief ?? ''),
        cwd: a.cwd ? String(a.cwd) : undefined,
        mode: a.mode ? String(a.mode) : undefined,
        model: a.model ? String(a.model) : undefined,
        session_id: a.session_id ? String(a.session_id) : undefined,
        attach_files: Array.isArray(a.attach_files)
          ? (a.attach_files as string[]).filter((f) => typeof f === 'string')
          : undefined,
        timeout_seconds: typeof a.timeout_seconds === 'number' ? a.timeout_seconds : undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ task_id: result.task_id, status: result.status, error: result.error }) }],
        isError: result.status === 'failed',
      };
    }

    case 'devin_delegate_status': {
      const task_id = String(a.task_id ?? '');
      const record = getTask(task_id);
      if (!record) {
        return { content: [{ type: 'text', text: 'task_not_found' }], isError: true };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            task_id: record.task_id,
            chi_run_id: record.chi_run_id,
            status: record.status,
            output: record.output.slice(-8_000), // tail for context window budget
            output_truncated: record.output_truncated || record.output.length > 8000,
            error: record.error,
            started_at: record.started_at,
            ended_at: record.ended_at,
          }),
        }],
        isError: record.status === 'failed' || record.status === 'timed_out',
      };
    }

    case 'devin_delegate_cancel': {
      const task_id = String(a.task_id ?? '');
      const result = cancelTask(task_id);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !result.ok,
      };
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}`
      );
  }
});


async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive until the transport closes.
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${PKG_ID}: fatal error:`, message);
  process.exit(1);
});
