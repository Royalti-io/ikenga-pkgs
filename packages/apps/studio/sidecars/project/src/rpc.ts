/**
 * JSON-RPC 2.0 over stdio — line-delimited (one JSON object per line).
 *
 * The sidecar reads requests from stdin and writes responses on stdout.
 * Notifications (no `id`) are emitted by ./events.ts; the watcher path
 * doesn't pass through this dispatcher.
 *
 * Logs always go to stderr (never stdout).
 */

import { createInterface, type Interface } from 'node:readline';
import { z } from 'zod';

import {
  ProjectSchema,
  type Project,
} from '@ikenga/studio-schema';

import type {
  ErrorCode,
  ProjectCloseParams,
  ProjectCreateParams,
  ProjectInfoParams,
  ProjectInfoResult,
  ProjectListResult,
  ProjectOpenParams,
  ProjectOpenResult,
  ProjectSummary,
  RpcMethod,
} from './rpc-types.js';

// ─────────────────────────────────────────────────────────────────────────
// JSON-RPC framing
// ─────────────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export function writeResponse(resp: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(resp) + '\n');
}

export function logErr(msg: string): void {
  process.stderr.write(`[studio-sidecar] ${msg}\n`);
}

// ─────────────────────────────────────────────────────────────────────────
// Handler interface (impl lives in index.ts)
// ─────────────────────────────────────────────────────────────────────────

export interface RpcHandlers {
  open(params: ProjectOpenParams): Promise<ProjectOpenResult>;
  close(params: ProjectCloseParams): Promise<{ ok: true } | { ok: false; error: ErrorCode; message?: string }>;
  list(): Promise<ProjectListResult>;
  create(params: ProjectCreateParams): Promise<ProjectOpenResult>;
  info(params: ProjectInfoParams): Promise<ProjectInfoResult>;
}

// ─────────────────────────────────────────────────────────────────────────
// Param schemas (re-validation on input)
// ─────────────────────────────────────────────────────────────────────────

const OpenParamsSchema = z.object({ path: z.string().min(1) });
const CloseParamsSchema = z.object({ projectId: z.string().min(1) });
const CreateParamsSchema = z.object({
  archetype_id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
});
const InfoParamsSchema = z.object({ projectId: z.string().min(1) });

// ─────────────────────────────────────────────────────────────────────────
// Project shape validation (used by handlers when hydrating from disk)
// ─────────────────────────────────────────────────────────────────────────

export function validateProject(input: unknown): Project {
  return ProjectSchema.parse(input);
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatch loop
// ─────────────────────────────────────────────────────────────────────────

function invalidParams(id: number | string | null, message: string): void {
  writeResponse({
    jsonrpc: '2.0',
    id,
    error: { code: -32602, message: `invalid params: ${message}` },
  });
}

function methodNotFound(id: number | string | null, method: string): void {
  writeResponse({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  });
}

function parseError(): void {
  writeResponse({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700, message: 'parse error' },
  });
}

export function startRpcLoop(handlers: RpcHandlers): { close(): void } {
  const rl: Interface = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      parseError();
      return;
    }
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      writeResponse({
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: { code: -32600, message: 'invalid request' },
      });
      return;
    }

    const id = req.id ?? null;
    try {
      switch (req.method as RpcMethod) {
        case 'project.open': {
          const p = OpenParamsSchema.safeParse(req.params);
          if (!p.success) return invalidParams(id, p.error.message);
          writeResponse({ jsonrpc: '2.0', id, result: await handlers.open(p.data) });
          return;
        }
        case 'project.close': {
          const p = CloseParamsSchema.safeParse(req.params);
          if (!p.success) return invalidParams(id, p.error.message);
          writeResponse({ jsonrpc: '2.0', id, result: await handlers.close(p.data) });
          return;
        }
        case 'project.list': {
          writeResponse({ jsonrpc: '2.0', id, result: await handlers.list() });
          return;
        }
        case 'project.create': {
          const p = CreateParamsSchema.safeParse(req.params);
          if (!p.success) return invalidParams(id, p.error.message);
          writeResponse({ jsonrpc: '2.0', id, result: await handlers.create(p.data) });
          return;
        }
        case 'project.info': {
          const p = InfoParamsSchema.safeParse(req.params);
          if (!p.success) return invalidParams(id, p.error.message);
          writeResponse({ jsonrpc: '2.0', id, result: await handlers.info(p.data) });
          return;
        }
        default:
          return methodNotFound(id, req.method);
      }
    } catch (err) {
      logErr(`handler threw on ${req.method}: ${(err as Error).message}`);
      writeResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'internal error', data: (err as Error).message },
      });
    }
  });

  return {
    close() {
      rl.close();
    },
  };
}

// Helper used by index.ts when building a `ProjectSummary` from a row.
export function toProjectSummary(row: {
  project_id: string;
  path: string;
  name: string;
  last_opened: number;
}): ProjectSummary {
  return {
    projectId: row.project_id,
    path: row.path,
    name: row.name,
    lastOpened: row.last_opened,
  };
}
