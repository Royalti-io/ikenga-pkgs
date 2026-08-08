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
  const { name } = request.params;
  switch (name) {
    case 'devin_status': {
      const status = await devinStatus();
      return {
        content: [{ type: 'text', text: status.kind }],
        isError: status.kind !== 'ready',
        _meta: { version: 'version' in status ? status.version : undefined },
      };
    }
    case 'devin_run':
    case 'devin_list_sessions':
    case 'devin_resume':
    case 'devin_delegate':
    case 'devin_delegate_status':
    case 'devin_delegate_cancel': {
      return {
        content: [{ type: 'text', text: `not_implemented: ${name} not yet wired` }],
        isError: true,
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
