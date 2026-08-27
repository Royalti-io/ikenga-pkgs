/**
 * com.ikenga.git · git-core — the single spawn primitive.
 *
 * Everything git-core ever executes goes through `spawnChild`. That is what
 * makes the G-16 env property (`env.ts`) provable rather than asserted: there
 * is exactly one place where a child's environment is decided, so the
 * env-asymmetry test can drive that one place and know it has covered the
 * `git` path, the `gh` path, and any future one.
 *
 * The containment boundary is NOT here — it is `argv.ts`. `spawnChild` will
 * run whatever binary it is handed; what stops that from mattering is that no
 * caller outside git-core constructs argv, and every builder in `argv.ts`
 * re-scans its own output before returning it. Keeping the primitive dumb and
 * the builders strict is deliberate: a spawn function that also tried to
 * validate would be a second, drifting copy of the allowlist.
 *
 * Three properties hold for every spawn:
 *   · `shell: false` — always. There is no code path in this pkg that reaches
 *     `/bin/sh`, so no quoting bug can become a command injection.
 *   · `env: buildChildEnv()` — clear-first, `IKENGA_*` stripped,
 *     `GIT_TERMINAL_PROMPT=0` forced, credential/signing env untouched.
 *   · a deadline — a spawn that would hang (a credential prompt that got past
 *     `GIT_TERMINAL_PROMPT=0`, an unreachable remote) is killed and reported
 *     as `timeout`, never left to hold a supervised process forever.
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { buildChildEnv } from './env.js';
import { fromGitFailure, gitError } from './errors.js';
import type { GitError } from './rpc.js';

/** Default deadline for a local read. Generous enough for `status` on a large
 *  tree, short enough that a wedged spawn surfaces within one UI beat. */
export const DEFAULT_TIMEOUT_MS = 20_000;
/** `fetch` reaches the network; local read budgets do not apply. */
export const NETWORK_TIMEOUT_MS = 120_000;

export interface SpawnOptions {
  /** Working directory. This is how git-core targets a repo — never `-C`,
   *  never `GIT_DIR` (see `env.ts` §ENV_DENY_EXACT). */
  cwd: string;
  /** Written to the child's stdin, then stdin is closed. Used only by
   *  `commit -F -`, so a commit message never touches argv. */
  stdin?: string;
  timeoutMs?: number;
  /** `utf8` decodes stdout; `buffer` leaves it raw. A patch can contain
   *  invalid UTF-8 (git emits bytes for a latin-1 file), and decoding it
   *  lossily would corrupt the diff the UI renders. */
  encoding?: 'utf8' | 'buffer';
  /** Injectable for tests. Defaults to `process.env`. */
  parentEnv?: NodeJS.ProcessEnv;
  /** Hard cap on captured stdout. A `diff` of a generated file can be
   *  hundreds of MB; the supervised process must not die of it. */
  maxBuffer?: number;
}

export interface ExecOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stdoutBytes: Buffer;
  stderr: string;
  timedOut: boolean;
  /** True when stdout hit `maxBuffer` and was cut. */
  truncated: boolean;
  /** Wall-clock ms. Useful for the "diff renders under 200 ms" gate. */
  durationMs: number;
}

/** 64 MiB. Above this, a UI is not going to render it anyway. */
export const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Spawn a child with git-core's environment. Rejects only on a spawn-level
 * failure (`ENOENT`), which callers translate to `git-missing` / `gh-missing`;
 * a non-zero exit is a normal resolution, not an exception.
 */
export function spawnChild(
  bin: string,
  argv: readonly string[],
  opts: SpawnOptions
): Promise<ExecOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const started = Date.now();

  return new Promise<ExecOutcome>((resolve, reject) => {
    const child = spawn(bin, [...argv], {
      cwd: opts.cwd,
      env: buildChildEnv(opts.parentEnv ?? process.env),
      // Never a shell. Not "usually" — the whole argv discipline in `argv.ts`
      // is worth nothing if a shell re-parses the result.
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    // Do not hold the event loop open on this timer — a one-shot invocation
    // must be able to exit as soon as its work is done.
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (c: Buffer) => {
      if (outBytes >= maxBuffer) {
        truncated = true;
        return;
      }
      outBytes += c.length;
      outChunks.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      // stderr is bounded much lower: it is diagnostic text, and a runaway
      // stderr is itself the bug.
      if (errBytes >= 1024 * 1024) return;
      errBytes += c.length;
      errChunks.push(c);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBytes = Buffer.concat(outChunks);
      resolve({
        code,
        signal,
        stdout: stdoutBytes.toString('utf8'),
        stdoutBytes,
        stderr: Buffer.concat(errChunks).toString('utf8'),
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    });

    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin, 'utf8');
    } else {
      // Close stdin explicitly. A git subprocess that inherits an open stdin
      // it never reads is one of the ways a supervised sidecar wedges.
      child.stdin.end();
    }
  });
}

/** Which binary a call targets. Two values, both peer binaries the user owns —
 *  git-core never ships or vendors either (§Upstream library posture). */
export type Binary = 'git' | 'gh';

const MISSING_REASON: Readonly<Record<Binary, 'git-missing' | 'gh-missing'>> = {
  git: 'git-missing',
  gh: 'gh-missing',
};

export type ExecResult = { ok: true; outcome: ExecOutcome } | GitError;

/**
 * Is the failure the CWD's fault rather than the binary's?
 *
 * `child_process.spawn` reports a missing/unusable `cwd` with the same
 * `ENOENT` it reports for a missing binary — the errno belongs to the whole
 * `posix_spawn`, not to one of its inputs. Mapping that straight to
 * `git-missing` produced the worst possible diagnosis: "git was not found on
 * PATH" for a user whose git is fine and whose repo directory has simply been
 * deleted, moved, or is a stale worktree path. `git-missing` is a
 * fix-your-machine error; a vanished cwd is a G-05 state-table answer
 * (`unreadable` — "cannot read", per §Shared state contract (d)), and it names
 * the path so the UI can say WHICH directory went away.
 *
 * Probing costs one `stat`, and only on a spawn failure — never on the hot
 * path. Returns `null` when the cwd is a perfectly good directory, which is
 * the only case where a `git-missing` / `gh-missing` verdict is honest.
 */
async function cwdFault(cwd: string): Promise<GitError | null> {
  try {
    const st = await stat(cwd);
    if (st.isDirectory()) return null;
    return gitError('unreadable', `working directory is not a directory: ${cwd}`, { path: cwd });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return gitError('unreadable', `cannot read working directory ${cwd}: ${e.code ?? e.message}`, {
      path: cwd,
    });
  }
}

/**
 * Run `git` or `gh`, translating spawn failures and deadlines into the frozen
 * error vocabulary. A NON-ZERO EXIT IS STILL `ok: true` — the caller decides
 * whether it is a failure, because several call sites treat a non-zero exit as
 * data (`merge-base` exits 1 for unrelated histories, `rev-parse --verify
 * --quiet` exits 1 for an unknown ref, `gh auth status` exits 1 for logged
 * out). Use `expectSuccess` when a non-zero exit really is a failure.
 */
export async function exec(
  bin: Binary,
  argv: readonly string[],
  opts: SpawnOptions
): Promise<ExecResult> {
  let outcome: ExecOutcome;
  try {
    outcome = await spawnChild(bin, argv, opts);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // A spawn-level errno is ambiguous between the binary and the cwd — settle
    // that before blaming either. See `cwdFault`.
    if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'ENOTDIR') {
      const fault = await cwdFault(opts.cwd);
      if (fault) return fault;
    }
    if (e.code === 'ENOENT') {
      return gitError(MISSING_REASON[bin], `${bin} was not found on PATH`);
    }
    if (e.code === 'EACCES') {
      return gitError('unreadable', `${bin} is not executable`);
    }
    return gitError('internal', `failed to spawn ${bin}: ${e.message}`);
  }

  if (outcome.timedOut) {
    return gitError(
      'timeout',
      `${bin} ${argv[0] ?? ''} exceeded its ${String(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms deadline`,
      { stderr: outcome.stderr }
    );
  }

  return { ok: true, outcome };
}

/** `exec`, but a non-zero exit is classified into a `GitError` (index-locked,
 *  operation-in-progress, dirty-tree, …) via `errors.classifyGitFailure`. */
export async function expectSuccess(
  bin: Binary,
  argv: readonly string[],
  opts: SpawnOptions
): Promise<{ ok: true; outcome: ExecOutcome } | GitError> {
  const res = await exec(bin, argv, opts);
  if (res.ok !== true) return res;
  if (res.outcome.code !== 0) return fromGitFailure(res.outcome.code, res.outcome.stderr);
  return res;
}

/**
 * Run a builder's output. Threads the `ArgvResult` union through so a call
 * site reads as one expression instead of a validate-then-spawn dance, and so
 * a validation failure can never be spawned by accident.
 */
export async function run(
  bin: Binary,
  built: { ok: true; argv: string[]; stdin?: string } | GitError,
  opts: SpawnOptions
): Promise<{ ok: true; outcome: ExecOutcome } | GitError> {
  if (built.ok !== true) return built;
  return expectSuccess(bin, built.argv, {
    ...opts,
    stdin: built.stdin ?? opts.stdin,
  });
}

/** `run`, tolerating a non-zero exit (see `exec`). */
export async function runTolerant(
  bin: Binary,
  built: { ok: true; argv: string[]; stdin?: string } | GitError,
  opts: SpawnOptions
): Promise<{ ok: true; outcome: ExecOutcome } | GitError> {
  if (built.ok !== true) return built;
  return exec(bin, built.argv, { ...opts, stdin: built.stdin ?? opts.stdin });
}
