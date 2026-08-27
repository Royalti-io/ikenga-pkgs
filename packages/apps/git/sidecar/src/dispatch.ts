/**
 * com.ikenga.git · sidecar — JSON-RPC dispatch (WP-04).
 *
 * The frozen contract's §REGISTRATION CHECKLIST leaves exactly one
 * hand-written place for a new method: the `switch` below. It is
 * exhaustiveness-checked — `default: assertNever(method)` stops compiling the
 * moment `RPC_METHODS` gains a literal that has no case — which is the fix for
 * the studio gate lesson recorded in memory ("new sidecar RPC = add switch-case
 * + `RpcMethod` + `EXTENDED_METHODS` allowlist — tsc can't catch the Set").
 * Here there is no Set, the union and the spec table are one object, and the
 * switch is the only thing left that a human maintains.
 *
 * ── Two error layers, both real ─────────────────────────────────────────────
 *
 *   · JSON-RPC `error` — the call never reached a handler: unparseable line,
 *     malformed envelope, unknown method. Standard codes only.
 *   · `result.ok === false` — a handler ran and the OPERATION failed. Every
 *     `GitErrorReason` lives here.
 *
 * A consumer that handles only the first will read `not-a-repository` as
 * success. Both are emitted, and never interchangeably.
 *
 * ── Why arguments AND results are validated ─────────────────────────────────
 *
 * Arguments, because `rpc.ts` DELTA 5 puts option-injection rejection in the
 * Zod schemas: a pathspec of `--upload-pack=touch /tmp/pwn` fails a hardening
 * refinement, and `reasonForParseFailure` (via `fromZodError`) classifies it as
 * `unsafe-argument` rather than flattening it into `invalid-args`. That
 * distinction is what verification 6 asserts on, and it is shared with the MCP
 * precisely because both call the same function.
 *
 * Results, because the response crosses a process boundary into a UI that
 * trusts the contract. Parsing through `RpcSpec[method].result` means a handler
 * that drifts from the schema fails HERE, loudly, instead of rendering as an
 * undefined field three layers away — and it strips any excess key, so the
 * wire shape is the frozen shape.
 */

import {
  RPC_ERROR,
  RpcRequestSchema,
  RpcSpec,
  assertNever,
  fromZodError,
  gitError,
  isRpcMethod,
  type ArgsOf,
  type RpcMethod,
  type RpcResponse,
} from '../../core/src/index.js';
import { handlers } from './handlers.js';

/** Diagnostics go to stderr. stdout is the JSON-RPC channel and nothing else. */
export function logErr(message: string): void {
  process.stderr.write(`[git-sidecar] ${message}\n`);
}

/**
 * Run one method. Arguments are parsed against the frozen schema first, so a
 * handler never sees a shape it did not declare.
 */
export async function dispatch(method: RpcMethod, params: unknown): Promise<unknown> {
  const spec = RpcSpec[method];

  // `params` is optional in the JSON-RPC envelope; every args schema in the
  // contract is an object, and `{}` is the correct empty value for the ones
  // whose fields are all optional (`system.probe`, `project.scan`).
  const parsed = spec.args.safeParse(params ?? {});
  if (!parsed.success) return fromZodError(parsed.error);
  // Widened once here; each case below narrows it back with the method's own
  // `ArgsOf<…>`. The alternative — indexing `handlers[method]` with the union —
  // does not typecheck, because a union of call signatures accepts only the
  // intersection of their parameters.
  const a: unknown = parsed.data;

  let result: unknown;
  switch (method) {
    case 'system.probe':
      // `SystemProbeArgs` is the empty object; the handler declares no
      // parameter, so passing `a` would be an arity error rather than a cast.
      result = await handlers['system.probe']();
      break;
    case 'project.scan':
      result = await handlers['project.scan'](a as ArgsOf<'project.scan'>);
      break;
    case 'repo.snapshot':
      result = await handlers['repo.snapshot'](a as ArgsOf<'repo.snapshot'>);
      break;
    case 'repo.aheadBehind':
      result = await handlers['repo.aheadBehind'](a as ArgsOf<'repo.aheadBehind'>);
      break;
    case 'repo.fetch':
      result = await handlers['repo.fetch'](a as ArgsOf<'repo.fetch'>);
      break;
    case 'changes.list':
      result = await handlers['changes.list'](a as ArgsOf<'changes.list'>);
      break;
    case 'changes.diff':
      result = await handlers['changes.diff'](a as ArgsOf<'changes.diff'>);
      break;
    case 'changes.stage':
      result = await handlers['changes.stage'](a as ArgsOf<'changes.stage'>);
      break;
    case 'changes.unstage':
      result = await handlers['changes.unstage'](a as ArgsOf<'changes.unstage'>);
      break;
    case 'commit.create':
      result = await handlers['commit.create'](a as ArgsOf<'commit.create'>);
      break;
    case 'history.log':
      result = await handlers['history.log'](a as ArgsOf<'history.log'>);
      break;
    case 'history.commit':
      result = await handlers['history.commit'](a as ArgsOf<'history.commit'>);
      break;
    case 'branch.list':
      result = await handlers['branch.list'](a as ArgsOf<'branch.list'>);
      break;
    case 'branch.create':
      result = await handlers['branch.create'](a as ArgsOf<'branch.create'>);
      break;
    case 'branch.checkout':
      result = await handlers['branch.checkout'](a as ArgsOf<'branch.checkout'>);
      break;
    case 'worktree.list':
      result = await handlers['worktree.list'](a as ArgsOf<'worktree.list'>);
      break;
    default:
      // Unreachable while every literal in `RPC_METHODS` has a case above; the
      // compiler proves it, and this line is what makes it prove it.
      return assertNever(method);
  }

  const checked = spec.result.safeParse(result);
  if (!checked.success) {
    logErr(`result schema violation on ${method}: ${checked.error.issues[0]?.message ?? 'unknown'}`);
    return gitError('internal', `${method} produced a result that does not match the contract`);
  }
  return checked.data;
}

/**
 * Handle one line of the input stream, returning the response to write.
 *
 * Returns `null` for a blank line — not an error, just nothing to do.
 */
export async function handleLine(line: string): Promise<RpcResponse | null> {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    logErr(`unparseable request: ${trimmed.slice(0, 200)}`);
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC_ERROR.parseError, message: 'request is not valid JSON' },
    };
  }

  const envelope = RpcRequestSchema.safeParse(raw);
  if (!envelope.success) {
    // Salvage the id when the payload carried a usable one, so a caller that
    // multiplexes requests can still match the failure to its call.
    const id = (raw as { id?: unknown })?.id;
    return {
      jsonrpc: '2.0',
      id: typeof id === 'number' || typeof id === 'string' ? id : null,
      error: { code: RPC_ERROR.invalidRequest, message: 'malformed JSON-RPC request' },
    };
  }

  const req = envelope.data;
  if (!isRpcMethod(req.method)) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      error: { code: RPC_ERROR.methodNotFound, message: `unknown method: ${req.method}` },
    };
  }

  try {
    return { jsonrpc: '2.0', id: req.id, result: await dispatch(req.method, req.params) };
  } catch (err) {
    // Nothing in git-core throws for an expected condition, so reaching here
    // is a programmer error. Report it as an operational `internal` result —
    // the caller has a `reason` to render either way — and put the stack on
    // stderr where it is useful.
    const e = err as Error;
    logErr(`unhandled error in ${req.method}: ${e.stack ?? e.message}`);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: gitError('internal', `${req.method} failed unexpectedly: ${e.message}`),
    };
  }
}
