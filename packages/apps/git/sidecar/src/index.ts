/**
 * com.ikenga.git — sidecar entry (WP-02 scaffold stub).
 *
 * Long-lived Node-ESM process, bundled by `bun build --target=node
 * --format=esm` (see ./build.sh) and supervised by the kernel per
 * `manifest.json#sidecars[0]` (stdio: "json").
 *
 * This stub proves the process boots, speaks JSON-RPC 2.0 line-delimited
 * over stdio, and never crashes the supervisor — the actual repo
 * discovery / fs-watch / status cache / mutation RPC dispatch (switch-case +
 * `RpcMethod` union + `EXTENDED_METHODS` allowlist, per the studio gate
 * lesson) lands in WP-04 against the frozen `drafts/rpc.ts` (G-RPC).
 *
 * Logs go to stderr only — stdout is the JSON-RPC channel.
 */

import { createInterface } from 'node:readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function logErr(msg: string): void {
  process.stderr.write(`[git-sidecar] ${msg}\n`);
}

function writeResponse(resp: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(resp)}\n`);
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    logErr(`dropped unparseable line: ${trimmed.slice(0, 200)}`);
    return;
  }

  // WP-04 replaces this with the real RpcMethod dispatch table. Until then,
  // every method returns a structured "not implemented" — never a throw,
  // matching the G-05 `{ok:false, reason}` contract this pkg standardizes on.
  writeResponse({
    jsonrpc: '2.0',
    id: req.id,
    result: { ok: false, reason: 'not_implemented', method: req.method },
  });
});

rl.on('close', () => {
  logErr('stdin closed, exiting');
  process.exit(0);
});

logErr('com.ikenga.git sidecar started (WP-02 scaffold stub)');
