/**
 * main.ts — entry point for the local-store-etl sidecar.
 *
 * Implements the ikenga sidecar stdio protocol: reads newline-delimited JSON
 * requests from stdin, dispatches to the appropriate handler, writes a JSON
 * response to stdout.
 *
 * Supported methods:
 *   run   — load data into pa.db (mode: "fixture" | "live")
 *   ping  — health-check (returns { pong: true })
 *
 * Wave 4: the `live` mode will call `extractLive(supabaseUrl, serviceRoleKey)`
 * and pipe the result through the same writer path.
 */

import { writeDataset } from './etl.js';
import { fixture } from './fixture.js';
import type { RpcRequest, RpcResponse, RunParams, RunResult } from './types.js';

// ── dispatch ──────────────────────────────────────────────────────────────────

async function handleRun(params: RunParams): Promise<RunResult> {
  const { mode, tables, db_path, dry_run = false } = params;

  if (mode === 'live') {
    throw new Error(
      'mode "live" is not yet implemented (Wave 4). Use mode "fixture" for local testing.',
    );
  }

  const dataset = fixture();
  const start = Date.now();
  const tableResults = writeDataset({ db_path, dataset, tables, dry_run });
  const elapsed_ms = Date.now() - start;

  const is_no_op = tableResults.every((t) => t.rows_inserted === 0);

  return {
    mode,
    tables: tableResults,
    elapsed_ms,
    is_no_op,
  };
}

function ok<T>(id: RpcRequest['id'], result: T): RpcResponse<T> {
  return { id, result };
}

function err(
  id: RpcRequest['id'],
  code: number,
  message: string,
): RpcResponse {
  return { id, error: { code, message } };
}

async function dispatch(req: RpcRequest): Promise<RpcResponse> {
  switch (req.method) {
    case 'ping':
      return ok(req.id, { pong: true });

    case 'run': {
      const params = req.params as RunParams;
      if (!params?.db_path) {
        return err(req.id, -32602, 'run: params.db_path is required');
      }
      if (!params.mode || !['fixture', 'live'].includes(params.mode)) {
        return err(
          req.id,
          -32602,
          'run: params.mode must be "fixture" or "live"',
        );
      }
      const result = await handleRun(params);
      return ok(req.id, result);
    }

    default:
      return err(req.id, -32601, `method not found: ${req.method}`);
  }
}

// ── main loop ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  for await (const chunk of Bun.stdin.stream()) {
    const text = decoder.decode(chunk).trim();
    if (!text) continue;

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let req: RpcRequest;
      try {
        req = JSON.parse(trimmed) as RpcRequest;
      } catch {
        const resp: RpcResponse = {
          id: -1,
          error: { code: -32700, message: 'Parse error' },
        };
        await Bun.stdout.write(encoder.encode(JSON.stringify(resp) + '\n'));
        continue;
      }

      let resp: RpcResponse;
      try {
        resp = await dispatch(req);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        resp = err(req.id, -32603, `Internal error: ${msg}`);
      }

      await Bun.stdout.write(encoder.encode(JSON.stringify(resp) + '\n'));
    }
  }
}

main().catch((e) => {
  console.error('[local-store-etl] fatal:', e);
  process.exit(1);
});
