/**
 * Child-process manager + JSON-RPC client for the @ikenga/studio project
 * sidecar.
 *
 * Spawns `node <sidecar.js>`, pipes line-delimited JSON-RPC over its
 * stdio, correlates requests by `id`, fans out `event` notifications
 * (`method: 'event'` per sidecar `events.ts`) to subscribers, and
 * auto-respawns on stdio EOF with exponential backoff (up to 3 retries).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// JSON-RPC framing types (mirror sidecars/project/src/rpc.ts)
// ─────────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcEventNotification {
  jsonrpc: '2.0';
  method: 'event';
  params: {
    topic: string;
    projectId: string;
    payload: unknown;
    ts: number;
  };
}

export type EventListener = (evt: JsonRpcEventNotification['params']) => void;

// ─────────────────────────────────────────────────────────────────────────
// Sidecar path resolution
// ─────────────────────────────────────────────────────────────────────────

function defaultSidecarPath(): string {
  if (process.env.STUDIO_SIDECAR_PATH) return process.env.STUDIO_SIDECAR_PATH;
  // dist/index.js → ../../sidecars/project/dist/sidecar.js  (relative to MCP dist)
  // src/sidecar-client.ts (during typecheck) → ../../sidecars/project/dist/sidecar.js
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, '../../sidecars/project/dist/sidecar.js');
}

// ─────────────────────────────────────────────────────────────────────────
// SidecarClient
// ─────────────────────────────────────────────────────────────────────────

export interface SidecarClientOptions {
  /** Absolute path to the sidecar's built `dist/sidecar.js`. Defaults to STUDIO_SIDECAR_PATH or `../../sidecars/project/dist/sidecar.js`. */
  sidecarPath?: string;
  /** Optional env overrides passed to the child. */
  env?: NodeJS.ProcessEnv;
  /** Max auto-respawn attempts before giving up (default 3). */
  maxRespawnAttempts?: number;
}

export interface SidecarCallOptions {
  /** Per-call timeout in ms (default 30_000). */
  timeoutMs?: number;
}

export class SidecarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidecarUnavailableError';
  }
}

export class SidecarRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'SidecarRpcError';
    this.code = code;
    this.data = data;
  }
}

export class SidecarClient {
  private child: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private listeners = new Set<EventListener>();
  private respawnAttempts = 0;
  private respawning = false;
  private readonly sidecarPath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxRespawnAttempts: number;
  private deadReason: string | null = null;
  private shuttingDown = false;

  constructor(opts: SidecarClientOptions = {}) {
    this.sidecarPath = opts.sidecarPath ?? defaultSidecarPath();
    this.env = { ...process.env, ...(opts.env ?? {}) };
    this.maxRespawnAttempts = opts.maxRespawnAttempts ?? 3;
  }

  start(): void {
    if (this.child) return;
    this.spawnChild();
  }

  /** Subscribe to event notifications. Returns an unsubscribe fn. */
  onEvent(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Send a JSON-RPC request and await its response. */
  async call<T = unknown>(method: string, params?: unknown, opts: SidecarCallOptions = {}): Promise<T> {
    if (this.deadReason && !this.child) {
      throw new SidecarUnavailableError(this.deadReason);
    }
    if (!this.child) this.spawnChild();
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw new SidecarUnavailableError('sidecar stdin not writable');
    }

    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const timeoutMs = opts.timeoutMs ?? 30_000;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sidecar call '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      try {
        child.stdin!.write(JSON.stringify(req) + '\n');
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new SidecarUnavailableError(`sidecar write failed: ${(e as Error).message}`));
      }
    });
  }

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (!this.child) return;
    try {
      this.child.stdin?.end();
    } catch {
      // ignore
    }
    // Give it 1.5s to exit cleanly, then SIGTERM.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try { this.child?.kill('SIGTERM'); } catch { /* ignore */ }
        resolve();
      }, 1500);
      this.child?.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  // ─── internals ─────────────────────────────────────────────────────────

  private spawnChild(): void {
    if (!existsSync(this.sidecarPath)) {
      this.deadReason = `sidecar binary not found at ${this.sidecarPath}`;
      process.stderr.write(`[studio-mcp] ${this.deadReason}\n`);
      return;
    }

    process.stderr.write(`[studio-mcp] spawning sidecar: node ${this.sidecarPath}\n`);
    const child = spawn(process.execPath, [this.sidecarPath], {
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.deadReason = null;

    // Stderr → our stderr (preserve sidecar diagnostics).
    child.stderr?.on('data', (b: Buffer) => {
      process.stderr.write(b);
    });

    // Stdout → line-delimited JSON.
    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    this.rl = rl;
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: JsonRpcResponse | JsonRpcEventNotification;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcEventNotification;
      } catch {
        process.stderr.write(`[studio-mcp] sidecar emitted non-JSON line: ${trimmed.slice(0, 200)}\n`);
        return;
      }
      this.routeMessage(msg);
    });

    child.on('error', (err) => {
      process.stderr.write(`[studio-mcp] sidecar spawn error: ${err.message}\n`);
    });

    child.on('exit', (code, signal) => {
      process.stderr.write(`[studio-mcp] sidecar exited code=${code} signal=${signal}\n`);
      // Reject every in-flight call.
      const reason = `sidecar exited (code=${code} signal=${signal})`;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new SidecarUnavailableError(reason));
      }
      this.pending.clear();
      this.child = null;
      this.rl?.close();
      this.rl = null;

      if (this.shuttingDown) return;
      void this.attemptRespawn();
    });
  }

  private routeMessage(msg: JsonRpcResponse | JsonRpcEventNotification): void {
    // Event notification: no `id`, `method === 'event'`.
    if ('method' in msg && msg.method === 'event' && 'params' in msg) {
      const params = (msg as JsonRpcEventNotification).params;
      for (const l of this.listeners) {
        try { l(params); } catch (err) {
          process.stderr.write(`[studio-mcp] event listener threw: ${(err as Error).message}\n`);
        }
      }
      return;
    }

    // Response.
    const resp = msg as JsonRpcResponse;
    if (resp.id == null || typeof resp.id !== 'number') return;
    const slot = this.pending.get(resp.id);
    if (!slot) return;
    this.pending.delete(resp.id);
    clearTimeout(slot.timer);
    if (resp.error) {
      slot.reject(new SidecarRpcError(resp.error.code, resp.error.message, resp.error.data));
    } else {
      slot.resolve(resp.result);
    }
  }

  private async attemptRespawn(): Promise<void> {
    if (this.respawning) return;
    this.respawning = true;
    try {
      while (this.respawnAttempts < this.maxRespawnAttempts) {
        this.respawnAttempts++;
        const backoff = Math.min(2000 * 2 ** (this.respawnAttempts - 1), 8000);
        process.stderr.write(
          `[studio-mcp] sidecar respawn attempt ${this.respawnAttempts}/${this.maxRespawnAttempts} in ${backoff}ms\n`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        if (this.shuttingDown) return;
        this.spawnChild();
        if (this.child) {
          // Spawned. Reset counter on first successful tool call (see resetRespawnCounter).
          // For now, consider any successful spawn a recovery.
          this.respawnAttempts = 0;
          return;
        }
      }
      this.deadReason = `sidecar respawn gave up after ${this.maxRespawnAttempts} attempts`;
      process.stderr.write(`[studio-mcp] ${this.deadReason}\n`);
    } finally {
      this.respawning = false;
    }
  }
}
