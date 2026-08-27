/**
 * com.ikenga.git — sidecar entry point (WP-04).
 *
 * ── One-shot, by construction ───────────────────────────────────────────────
 *
 * `manifest.sidecars[]` entries are NOT supervised. The kernel's
 * `SidecarsRegistry` only resolves bin paths; the runtime path is
 * `host.pkgSidecarCall` → `pkg_sidecar_call`, which spawns a FRESH process per
 * call with `cwd` = the pkg install dir, writes the request to stdin, closes
 * it, and reads stdout to exit
 * (`shell/src-tauri/src/commands/pkg_sidecar.rs`; 04-discussion.md Round 4).
 *
 * So this process:
 *   1. reads stdin to EOF,
 *   2. answers every JSON-RPC request it found, in order,
 *   3. exits 0.
 *
 * It holds no cache, watches no files, and keeps no state between calls. The
 * `repo.changed` push signal belongs to the long-lived MCP (WP-05) — the only
 * supervised process this pkg has, and the only one whose
 * `notifications/message` frames the shell relays into the iframe.
 *
 * ── The stdout contract, exactly ────────────────────────────────────────────
 *
 * The shell parses the **last non-empty line of stdout** as JSON and hands it
 * to the iframe as `structuredContent` (`pkg-iframe-host.tsx`, the
 * `host.pkgSidecarCall` branch). Two consequences, both enforced below:
 *
 *   · **stdout carries JSON-RPC responses and nothing else.** A stray
 *     `console.log` anywhere in the bundle — or in a dependency — would become
 *     the "response" the UI parses. `console.log`/`info`/`debug`/`warn` are
 *     therefore rebound to stderr at startup rather than trusted not to fire.
 *
 *   · **exit 0, almost always.** The shell reads a non-zero exit as
 *     `result.ok === false` and never looks at stdout, which would hide a
 *     perfectly good `{ok:false, reason:'not-a-repository'}` behind "exit code
 *     1". Operational failure is a RESULT, not an exit status. The one
 *     exception is a failure to emit anything at all.
 */

import { handleLine, logErr } from './dispatch.js';
import { ONESHOT_ARGV, assertMcpSurface, assertNoDestructiveMethods } from '../../core/src/index.js';

/**
 * Rebind every stdout-writing console method to stderr.
 *
 * Not defensive programming for its own sake: this is the failure mode that
 * silently corrupts the transport, and it fires from code this file does not
 * own. Binding it once here costs nothing and makes the invariant structural.
 */
function protectStdout(): void {
  const toStderr =
    (level: string) =>
    (...args: unknown[]): void => {
      process.stderr.write(
        `[git-sidecar:${level}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
      );
    };
  console.log = toStderr('log');
  console.info = toStderr('info');
  console.debug = toStderr('debug');
  console.warn = toStderr('warn');
  console.error = toStderr('error');
}

/** Read stdin to EOF. The caller always closes it; a TTY means no input. */
async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  protectStdout();

  // Boot self-checks over the frozen contract. Both are cheap, both fail loudly
  // rather than at the first call site, and both guard a security property:
  // G-12 (no destructive-tier method exists) and G-MCP (the tool surface has
  // not drifted from the list the user signed off).
  try {
    assertNoDestructiveMethods();
    assertMcpSurface();
  } catch (err) {
    logErr(`contract self-check failed: ${(err as Error).message}`);
    return 1;
  }

  const mode = process.argv[2];
  if (mode !== undefined && mode !== ONESHOT_ARGV[0]) {
    // Lenient rather than fatal. The only invocation the contract defines is
    // `ONESHOT_ARGV` (`['rpc']`), but a bare spawn with no argv must still
    // answer a request on stdin rather than exit as "unknown mode" — that is
    // what a smoke test does, and failing it would look like a broken sidecar.
    logErr(`unknown mode "${mode}" — reading stdin as RPC anyway`);
  }

  const input = await readAllStdin();
  const lines = input.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    logErr('no request on stdin');
    return 0;
  }

  // Sequential on purpose. Requests in one batch can be causally ordered — a
  // `changes.stage` followed by a `changes.list` must not race — and the
  // one-shot transport sends exactly one request anyway, so there is nothing
  // to gain from interleaving.
  for (const line of lines) {
    const response = await handleLine(line);
    if (response === null) continue;
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const e = err as Error;
    logErr(`fatal: ${e.stack ?? e.message}`);
    process.exitCode = 1;
  });
