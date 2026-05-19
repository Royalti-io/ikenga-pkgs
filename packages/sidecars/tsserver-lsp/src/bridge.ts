/**
 * pa-com-ikenga-tsserver-lsp-bridge — long-lived sidecar that wraps
 * `typescript-language-server --stdio` and translates between the shell's
 * line-delimited JSON-RPC sidecar envelope and LSP's Content-Length framed
 * messages.
 *
 * Wire (toward shell, on this process's stdio):
 *   • stdin: one JSON-RPC 2.0 message per line. Requests (with `id`) and
 *     notifications both pass through to tsserver verbatim.
 *   • stdout: one JSON-RPC 2.0 message per line. Server responses to client
 *     requests have an `id`; server-pushed notifications (e.g.
 *     `textDocument/publishDiagnostics`) flow through unchanged.
 *   • stderr: free-form logging. Never JSON — the supervisor drains it.
 *
 * Lifecycle:
 *   • Child spawn happens lazily on first stdin message (typically
 *     `initialize`) so cold-start cost only hits the first consumer.
 *   • Idle shutdown: a follow-up phase will track open documents and exit
 *     after a quiet period. v1 stays alive until the shell terminates us.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve as resolvePath, dirname } from 'node:path';
import { existsSync } from 'node:fs';

import { createLspFrameDecoder, encodeLspFrame } from './lsp-codec.js';

function log(...args: unknown[]) {
  process.stderr.write(`[pa-tsserver-lsp] ${args.map(String).join(' ')}\n`);
}

function writeEnvelope(payload: string) {
  process.stdout.write(payload);
  process.stdout.write('\n');
}

let child: ChildProcessWithoutNullStreams | null = null;
const decoder = createLspFrameDecoder();

function resolveTsserverEntry(): string {
  // The kernel sets cwd to the pkg's install dir. typescript-language-server is
  // a runtime dep, so its module sits at <install>/node_modules/.../cli.mjs.
  //
  // Why not bundle into the compiled binary? Bun's `--compile` only bundles
  // modules reachable via static `import`, and typescript-language-server is
  // launched as a subprocess (we shell out to its CLI). So we resolve at
  // runtime against the real filesystem path the kernel chose for us.
  const candidates = [
    // dev: bridge.ts run directly via `bun run`
    resolvePath(process.cwd(), 'node_modules/typescript-language-server/lib/cli.mjs'),
    // installed: pkg root has node_modules from pnpm install
    resolvePath(process.cwd(), '../../../node_modules/typescript-language-server/lib/cli.mjs'),
    // bridge.ts dev case: walk up from import.meta.url too
  ];
  try {
    const metaPath = new URL(import.meta.url).pathname;
    if (!metaPath.startsWith('/$bunfs/')) {
      let dir = dirname(metaPath);
      for (let i = 0; i < 8; i++) {
        candidates.push(resolvePath(dir, 'node_modules/typescript-language-server/lib/cli.mjs'));
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  } catch {
    // ignore
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Could not locate typescript-language-server/lib/cli.mjs (cwd=${process.cwd()}, tried ${candidates.length} candidates)`,
  );
}

function resolveNodeRuntime(): string {
  // In bun-compiled mode, `process.execPath` IS this bridge binary, not a
  // real Node or Bun. We need a real ECMAScript runtime to launch tsserver's
  // CLI (a plain `.mjs` file). Look up the user's installed `node` (or
  // `bun`) via PATH; both can run the cli.mjs ESM entry.
  const pathDirs = (process.env.PATH ?? '').split(':');
  for (const candidate of ['node', 'bun']) {
    for (const dir of pathDirs) {
      const p = resolvePath(dir, candidate);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('Could not find `node` or `bun` on PATH to host typescript-language-server');
}

function spawnChild(): ChildProcessWithoutNullStreams {
  const entry = resolveTsserverEntry();
  const runtime = resolveNodeRuntime();
  log('spawning typescript-language-server', `${runtime} ${entry}`);
  const cp = spawn(runtime, [entry, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  }) as ChildProcessWithoutNullStreams;

  cp.stdout.on('data', (chunk: Buffer) => {
    for (const frame of decoder.feed(new Uint8Array(chunk))) {
      writeEnvelope(frame);
    }
  });
  cp.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
  cp.on('exit', (code, signal) => {
    log(`typescript-language-server exited code=${code} signal=${signal}`);
    decoder.reset();
    child = null;
    // Let the supervisor decide whether to restart this bridge.
    process.exit(code ?? 0);
  });
  cp.on('error', (err) => {
    log('child error', err);
  });
  return cp;
}

function ensureChild(): ChildProcessWithoutNullStreams {
  if (child) return child;
  child = spawnChild();
  return child;
}

const stdin = createInterface({ input: process.stdin, terminal: false });

stdin.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    // Validate JSON; if a caller passes garbage, log and drop.
    JSON.parse(trimmed);
  } catch (err) {
    log('drop non-json line', err);
    return;
  }
  const cp = ensureChild();
  cp.stdin.write(encodeLspFrame(trimmed));
});

stdin.on('close', () => {
  log('stdin closed, shutting down');
  if (child) {
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    child.kill('SIGTERM');
  }
  process.exit(0);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

log('pa-com-ikenga-tsserver-lsp-bridge ready (idle, awaiting first message)');
