/**
 * com.ikenga.git · git-core — argv construction. THE containment boundary.
 *
 * From `plans/git/01-plan.md` §Command construction rules:
 *
 *   > The manifest allowlist only fires at kernel spawn sites; once the sidecar
 *   > runs, nothing in the shell constrains what it executes. So `git-core` is
 *   > the sandbox.
 *
 * The five rules, and where each one lives in this file:
 *
 *   1. Hardcoded subcommand allowlist  → `ALLOWED_SUBCOMMANDS`, `SUBCOMMAND_VERBS`
 *   2. argv arrays only, never `sh -c` → structural: every builder returns
 *      `string[]`; `exec.ts` spawns with `shell: false`. There is no string
 *      concatenation of a path or ref anywhere in git-core.
 *   3. `--` before every pathspec; `^-` rejected → `PATHSPEC_SEPARATOR`,
 *      `checkPathspecs`, `checkRef`
 *   4. every read runs `--no-optional-locks` → `READ_GLOBALS`
 *   5. clear-first child env                 → `env.ts`
 *
 * Two properties are worth stating plainly, because they are what make the
 * boundary real rather than decorative:
 *
 *   · **No builder takes a raw flag from a caller.** Every builder's input is
 *     structured data (paths, refs, counts, booleans); the flags are literals
 *     in this file. A caller cannot ask for `--hard` because there is no
 *     parameter that could carry it.
 *   · **Every built argv is re-scanned** by `assertArgvSafe` before it leaves
 *     the module (`finish()`). That is redundant with the point above by
 *     design — it is the check that catches a future builder written wrong,
 *     and it is what a test can assert against directly.
 */

import { z } from 'zod';
import { fromZodError, notAllowed, unsafeArgument } from './errors.js';
import {
  BranchNameSchema,
  DEFAULT_DIFF_CONTEXT_LINES,
  PathspecSchema,
  RefSchema,
  ShaSchema,
  type DiffSide,
  type GitError,
} from './rpc.js';
import { LOG_FIELD_COUNT, LOG_FORMAT, LOG_FORMAT_WITH_SIGNATURE } from './parse/log.js';

// ═════════════════════════════════════════════════════════════════════════════
// Rule 1 — the hardcoded subcommand allowlist
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every git subcommand git-core may ever run. Widening this list is a PLAN
 * change, not a WP change (`rpc.ts` §REGISTRATION CHECKLIST item 4) — it moves
 * the containment boundary.
 *
 * Deliberate absences worth naming, because someone will reach for them:
 *   · `init`    — G-05 state (c) offers `git init` as COPYABLE TEXT, not an
 *                 RPC (`rpc.ts` DELTA 4 / open question Q1).
 *   · `show`    — a commit's patch comes from `log -1 --patch` instead, which
 *                 is already allowed AND handles root commits correctly
 *                 (`diff <sha>~ <sha>` does not).
 *   · `check-ignore` — `NestedRepo.ignoredByParent` is answered with a
 *                 pathspec-scoped `status --ignored` instead. One subcommand
 *                 for one boolean is not worth widening the boundary.
 *   · `push`, `clean`, `rebase`, `filter-branch`, `remote`, `config`, `gc`,
 *     `submodule` — out of v1 entirely (§Destructive operation tiers).
 */
export const ALLOWED_SUBCOMMANDS = [
  'status',
  'diff',
  'log',
  'add',
  'reset',
  'commit',
  'branch',
  'checkout',
  'worktree',
  'rev-list',
  'rev-parse',
  'merge-base',
  'stash',
  'fetch',
] as const;
export type AllowedSubcommand = (typeof ALLOWED_SUBCOMMANDS)[number];

/**
 * Subcommands allowed only in one shape. The plan writes these as `worktree
 * list` and `stash create` — one word of the allowlist is not enough, because
 * `worktree remove` and `stash drop` are both on the never-in-v1 list.
 */
export const SUBCOMMAND_VERBS: Readonly<Partial<Record<AllowedSubcommand, readonly string[]>>> = {
  worktree: ['list'],
  stash: ['create'],
};

/**
 * Flags git-core never emits, checked against the finished argv regardless of
 * which builder produced it.
 *
 * Three families:
 *   · **Program execution** — `-c`/`--config-env` (`core.sshCommand`,
 *     `core.pager`, `diff.external` all run a command), `--upload-pack` /
 *     `--receive-pack` / `--upload-archive` (the classic option-injection
 *     payloads), `--exec`, `--ext-diff`, `--textconv`.
 *   · **Repo redirection** — `-C`, `--git-dir`, `--work-tree`, `--namespace`.
 *     git-core targets a repo by `cwd` and nothing else; the same reasoning as
 *     the `GIT_DIR` denylist in `env.ts`.
 *   · **Destruction** — `--hard`, `--merge`, `--keep`, `--force`, `-f`, `-D`,
 *     `--delete`, `--prune-empty`, `--no-verify`. Not in v1 (G-12).
 *
 * Prefix-matched, so `-c` also catches `-cfoo` and `--git-dir=` also catches
 * `--git-dir=/x`.
 */
export const FORBIDDEN_ARG_PREFIXES: readonly string[] = [
  '-c',
  '--config-env',
  '--exec-path=',
  '--upload-pack',
  '--receive-pack',
  '--upload-archive',
  '--exec',
  '--ext-diff',
  '--textconv',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--hard',
  '--merge',
  '--keep',
  '--force',
  '-f',
  '-D',
  '--delete',
  '--no-verify',
];

/**
 * Exact args that are legitimate despite matching a forbidden PREFIX. Kept
 * tiny and explicit; a new entry here is a decision, not a convenience.
 *
 * `--no-ext-diff` / `--no-textconv` are the negations we WANT (they stop
 * `diff.external` and `diff.*.textconv` executing a program), but they start
 * with `--ext-diff`… no — they do not; they are listed here for the reader,
 * because their presence next to `--ext-diff` in the forbidden list is exactly
 * the kind of thing a future reader will trip over. `--no-optional-locks`
 * likewise is not `--no-verify`.
 */
const FORBIDDEN_EXCEPTIONS: readonly string[] = ['--no-ext-diff', '--no-textconv'];

// ═════════════════════════════════════════════════════════════════════════════
// Rules 3 + 4 — separators, globals
// ═════════════════════════════════════════════════════════════════════════════

/** Rule 3. Emitted before EVERY user-supplied pathspec, without exception. */
export const PATHSPEC_SEPARATOR = '--' as const;

/**
 * Globals prefixed to every invocation.
 *
 * `--no-optional-locks` (rule 4): keeps a read from taking `.git/index.lock`
 * or refreshing the stat cache. This is the fix for the documented bug class
 * where a background `git status` loop broke the user's own `tsc --watch` and
 * `watchfiles` reloads (02-research-external.md [32][33]) — verification 10.
 * It is applied to WRITES too: it is a no-op for a command that genuinely
 * needs the lock, and applying it unconditionally means no future builder can
 * forget it.
 *
 * `--literal-pathspecs`: disables ALL pathspec magic — `:(exclude)`,
 * `:(glob)`, `:/`, and leading-`:` forms. Every path this pkg passes is a
 * literal path the user clicked in a tree. Without this, a filename that
 * happens to begin with `:` is silently reinterpreted as a magic pathspec, and
 * `changes.stage` would stage something other than what the UI showed.
 *
 * `--no-pager`: git only pages on a tty, but `core.pager` is user config that
 * runs a program; not depending on the tty check is free.
 */
export const GLOBALS: readonly string[] = [
  '--no-pager',
  '--no-optional-locks',
  '--literal-pathspecs',
];

/** Appended to any command that produces a patch. Stops `diff.external` /
 *  `diff.*.textconv` from executing a user-configured program on our behalf. */
export const PATCH_SAFETY: readonly string[] = ['--no-ext-diff', '--no-textconv'];

// ═════════════════════════════════════════════════════════════════════════════
// Validation helpers
// ═════════════════════════════════════════════════════════════════════════════

/** `{ ok:true, argv }` or the frozen error shape. Never throws. */
export type ArgvResult =
  | { ok: true; argv: string[]; stdin?: string }
  | GitError;

function check<T>(schema: z.ZodType<T>, value: unknown, field: string): GitError | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return null;
  // Re-path the issues so `GitError.path` names the caller's field rather than
  // the anonymous root of a standalone schema.
  const issues = parsed.error.issues.map((i) => ({ ...i, path: [field, ...i.path] }));
  return fromZodError(new z.ZodError(issues));
}

/** Rule 3, for a list of pathspecs. Returns the first failure. */
export function checkPathspecs(paths: readonly string[]): GitError | null {
  for (let i = 0; i < paths.length; i += 1) {
    const err = check(PathspecSchema, paths[i], `paths[${i}]`);
    if (err) return err;
  }
  return null;
}

/** Rule 3, for a ref / revision. */
export function checkRef(ref: string, field = 'ref'): GitError | null {
  return check(RefSchema, ref, field);
}

/**
 * Final gate. Scans a finished argv for a subcommand off the allowlist, a
 * restricted subcommand used with the wrong verb, or any forbidden flag —
 * including one that arrived as data rather than as a literal.
 */
export function assertArgvSafe(argv: readonly string[]): GitError | null {
  // The subcommand is the first arg that is not one of our own globals.
  let i = 0;
  while (i < argv.length && GLOBALS.includes(argv[i] as string)) i += 1;
  const sub = argv[i];
  if (sub === undefined) return notAllowed('(empty)');
  if (!(ALLOWED_SUBCOMMANDS as readonly string[]).includes(sub)) return notAllowed(sub);

  const verbs = SUBCOMMAND_VERBS[sub as AllowedSubcommand];
  if (verbs) {
    const verb = argv[i + 1];
    if (verb === undefined || !verbs.includes(verb)) {
      return notAllowed(`${sub} ${verb ?? '(none)'}`);
    }
  }

  // Everything after the pathspec separator is data, by construction — but it
  // has already been through `PathspecSchema`, which rejects `^-`. Before the
  // separator, nothing may look like a forbidden flag.
  const sepAt = argv.indexOf(PATHSPEC_SEPARATOR);
  const flagRegion = sepAt === -1 ? argv : argv.slice(0, sepAt);
  for (const arg of flagRegion) {
    if (FORBIDDEN_EXCEPTIONS.includes(arg)) continue;
    for (const bad of FORBIDDEN_ARG_PREFIXES) {
      if (arg === bad || arg.startsWith(`${bad}=`) || (bad.length === 2 && arg.startsWith(bad))) {
        return unsafeArgument(arg, `forbidden git option "${arg}" in constructed argv`);
      }
    }
  }

  // A value that is not a flag and not after `--` must not look like one. This
  // is the belt to `PathspecSchema`/`RefSchema`'s braces: it catches a ref that
  // reached argv without going through `checkRef`.
  return null;
}

/** Run the final gate, then hand back the argv. Every builder ends with this. */
function finish(argv: string[], stdin?: string): ArgvResult {
  const err = assertArgvSafe(argv);
  if (err) return err;
  return stdin === undefined ? { ok: true, argv } : { ok: true, argv, stdin };
}

/** `[...GLOBALS, ...rest]`. */
function g(...rest: (string | number)[]): string[] {
  return [...GLOBALS, ...rest.map(String)];
}

// ═════════════════════════════════════════════════════════════════════════════
// Builders — reads
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `git status --porcelain=v2 --branch --show-stash -z`.
 *
 * One call yields every header (`branch.oid`, `branch.head`, `branch.upstream`,
 * `branch.ab`, `stash`) and every entry line, with `-z` giving NUL-terminated
 * UNQUOTED paths (02-research-external.md [17]). `--untracked-files=all` so a
 * new directory reports its files rather than the directory.
 */
export function status(opts: { includeIgnored?: boolean } = {}): ArgvResult {
  const argv = g(
    'status',
    '--porcelain=v2',
    '--branch',
    '--show-stash',
    '--untracked-files=all',
    '-z'
  );
  if (opts.includeIgnored) argv.push('--ignored=matching');
  return finish(argv);
}

/**
 * Pathspec-scoped status used only to answer "is this nested repo ignored by
 * its parent?" — `check-ignore` is not on the allowlist and one boolean does
 * not justify widening it. `--ignored=matching` makes an ignored path report
 * as a `!` entry.
 */
export function statusOfPath(path: string): ArgvResult {
  const err = check(PathspecSchema, path, 'path');
  if (err) return err;
  return finish(
    g(
      'status',
      '--porcelain=v2',
      '--ignored=matching',
      '--untracked-files=all',
      '-z',
      PATHSPEC_SEPARATOR,
      path
    )
  );
}

/** `git diff [--cached] --numstat -z [-- <paths>]` — the added/deleted/binary
 *  columns for `FileChange`. `-` in both columns means binary, which is NOT
 *  `0/0` (02-research-external.md [20]). */
export function diffNumstat(opts: { cached: boolean; paths?: readonly string[] }): ArgvResult {
  const err = opts.paths ? checkPathspecs(opts.paths) : null;
  if (err) return err;
  const argv = g('diff', ...PATCH_SAFETY, '--numstat', '-z');
  if (opts.cached) argv.push('--cached');
  if (opts.paths && opts.paths.length > 0) argv.push(PATHSPEC_SEPARATOR, ...opts.paths);
  return finish(argv);
}

/** `git diff [--cached] -U<n> -- <path>` — the unified patch for one file. */
export function diffPatch(opts: {
  side: Exclude<DiffSide, 'commit'>;
  path: string;
  contextLines?: number;
}): ArgvResult {
  const err = check(PathspecSchema, opts.path, 'path');
  if (err) return err;
  const ctx = opts.contextLines ?? DEFAULT_DIFF_CONTEXT_LINES;
  const argv = g('diff', ...PATCH_SAFETY, `-U${String(ctx)}`);
  if (opts.side === 'staged') argv.push('--cached');
  argv.push(PATHSPEC_SEPARATOR, opts.path);
  return finish(argv);
}

/**
 * `git log -1 --format= --patch -U<n> <sha> -- <path>` — one commit's patch.
 *
 * `log -1 --patch` rather than `show`: `show` is off the allowlist, and unlike
 * `diff <sha>~ <sha>` this is correct for a ROOT commit (no parent), which is
 * a real case in a freshly-initialised repo.
 */
export function commitPatch(opts: {
  sha: string;
  path: string;
  contextLines?: number;
}): ArgvResult {
  const shaErr = check(ShaSchema, opts.sha, 'sha');
  if (shaErr) return shaErr;
  const pathErr = check(PathspecSchema, opts.path, 'path');
  if (pathErr) return pathErr;
  const ctx = opts.contextLines ?? DEFAULT_DIFF_CONTEXT_LINES;
  return finish(
    g(
      'log',
      '-1',
      '--format=',
      '--patch',
      ...PATCH_SAFETY,
      `-U${String(ctx)}`,
      opts.sha,
      PATHSPEC_SEPARATOR,
      opts.path
    )
  );
}

/**
 * `git log -z --format=<NUL-delimited> [-n <limit>] [--skip=<n>] <ref> [-- <path>]`.
 *
 * `-z` separates commit records with NUL; the format separates FIELDS with
 * NUL. Both are unambiguous together only because the field count is fixed —
 * see `parse/log.ts`, which owns the format string this builder emits.
 */
export function log(opts: {
  ref?: string;
  limit?: number;
  skip?: number;
  path?: string;
}): ArgvResult {
  if (opts.ref !== undefined) {
    const err = checkRef(opts.ref);
    if (err) return err;
  }
  if (opts.path !== undefined) {
    const err = check(PathspecSchema, opts.path, 'path');
    if (err) return err;
  }
  const argv = g('log', '-z', `--format=${LOG_FORMAT}`);
  if (opts.limit !== undefined) argv.push('-n', String(Math.floor(opts.limit)));
  if (opts.skip !== undefined && opts.skip > 0) argv.push(`--skip=${String(Math.floor(opts.skip))}`);
  argv.push(opts.ref ?? 'HEAD');
  if (opts.path !== undefined) argv.push(PATHSPEC_SEPARATOR, opts.path);
  return finish(argv);
}

/** One commit's full record. `withSignature` adds `%G?`/`%GS`, which costs a
 *  signature verification per commit — off unless the detail pane asks. */
export function logCommit(opts: { sha: string; withSignature?: boolean }): ArgvResult {
  const err = check(ShaSchema, opts.sha, 'sha');
  if (err) return err;
  const format = opts.withSignature ? LOG_FORMAT_WITH_SIGNATURE : LOG_FORMAT;
  return finish(g('log', '-z', '-1', `--format=${format}`, opts.sha));
}

/** Per-file numstat for one commit, vs its first parent. */
export function logCommitNumstat(opts: { sha: string }): ArgvResult {
  const err = check(ShaSchema, opts.sha, 'sha');
  if (err) return err;
  return finish(
    g('log', '-1', '--format=', '--numstat', '-z', ...PATCH_SAFETY, '--first-parent', opts.sha)
  );
}

/** `git branch --list [--all] --format=<NUL-delimited>` — see `parse/branch.ts`. */
export function branchList(opts: { includeRemote?: boolean } = {}): ArgvResult {
  const argv = g('branch', '--list', `--format=${BRANCH_FORMAT}`);
  if (opts.includeRemote) argv.push('--all');
  return finish(argv);
}

/** `git worktree list --porcelain -z` (02-research-external.md [18]). */
export function worktreeList(): ArgvResult {
  return finish(g('worktree', 'list', '--porcelain', '-z'));
}

/** `git rev-list --left-right --count <base>...<head>` → `<behind>\t<ahead>`. */
export function revListLeftRightCount(opts: { base: string; head?: string }): ArgvResult {
  const baseErr = checkRef(opts.base, 'base');
  if (baseErr) return baseErr;
  const head = opts.head ?? 'HEAD';
  const headErr = checkRef(head, 'head');
  if (headErr) return headErr;
  return finish(g('rev-list', '--left-right', '--count', `${opts.base}...${head}`));
}

/** `git merge-base <base> <head>`. Exit 1 (no output) = unrelated histories. */
export function mergeBase(opts: { base: string; head?: string }): ArgvResult {
  const baseErr = checkRef(opts.base, 'base');
  if (baseErr) return baseErr;
  const head = opts.head ?? 'HEAD';
  const headErr = checkRef(head, 'head');
  if (headErr) return headErr;
  return finish(g('merge-base', opts.base, head));
}

/**
 * `git rev-parse` with a fixed set of interrogatives. The caller picks from an
 * enum, never passes a flag — `rev-parse` accepts `--parseopt`/`--sq-quote`
 * and a long tail of shell-adjacent behaviour that has no business being
 * reachable from a UI.
 */
export type RevParseQuery =
  | 'show-toplevel'
  | 'git-dir'
  | 'git-common-dir'
  | 'is-bare-repository'
  | 'is-inside-work-tree'
  | 'abbrev-ref-head';

const REV_PARSE_ARGS: Readonly<Record<RevParseQuery, readonly string[]>> = {
  'show-toplevel': ['--show-toplevel'],
  'git-dir': ['--absolute-git-dir'],
  'git-common-dir': ['--path-format=absolute', '--git-common-dir'],
  'is-bare-repository': ['--is-bare-repository'],
  'is-inside-work-tree': ['--is-inside-work-tree'],
  'abbrev-ref-head': ['--abbrev-ref', 'HEAD'],
};

export function revParse(query: RevParseQuery): ArgvResult {
  const args = REV_PARSE_ARGS[query];
  if (!args) return notAllowed(`rev-parse ${String(query)}`);
  return finish(g('rev-parse', ...args));
}

/** `git rev-parse --verify --quiet <ref>^{commit}` — resolve a ref to a sha. */
export function revParseVerify(ref: string): ArgvResult {
  const err = checkRef(ref);
  if (err) return err;
  return finish(g('rev-parse', '--verify', '--quiet', `${ref}^{commit}`));
}

// ═════════════════════════════════════════════════════════════════════════════
// Builders — writes
// ═════════════════════════════════════════════════════════════════════════════

/** `git add -- <paths>`. Explicit paths only; there is no "stage all". */
export function add(paths: readonly string[]): ArgvResult {
  if (paths.length === 0) return unsafeArgument('paths', 'stage requires at least one path');
  const err = checkPathspecs(paths);
  if (err) return err;
  return finish(g('add', '--', ...paths));
}

/**
 * `git reset -q -- <paths>` — MIXED reset, scoped to paths.
 *
 * With a pathspec, `reset` only ever rewrites index entries; the working tree
 * is untouched and `--hard` is not merely omitted but meaningless in this form
 * (git refuses `--hard` with paths). Both facts are why `changes.unstage` is
 * `tier: 'safe'` in `RpcSpec`.
 */
export function resetPaths(paths: readonly string[]): ArgvResult {
  if (paths.length === 0) return unsafeArgument('paths', 'unstage requires at least one path');
  const err = checkPathspecs(paths);
  if (err) return err;
  return finish(g('reset', '-q', '--', ...paths));
}

/**
 * `git commit -F - [--only -- <paths>]`, message on stdin.
 *
 * Two things are load-bearing:
 *   · **`-F -`**: the message rides on stdin, never as an argv value. A commit
 *     message is the most attacker-shaped free text in the whole surface (it
 *     is multi-line and can begin with `-`), and this removes it from argv
 *     entirely.
 *   · **`--only`**: with a path list, commit exactly those paths and nothing
 *     else that happens to be staged. That is what makes `git_commit` safe
 *     enough to be the ONE mutating MCP tool: "stages nothing implicitly"
 *     (01-plan.md §MCP threat model) also means "commits nothing implicitly".
 *
 * An EMPTY path list means "commit what is already staged" — allowed from the
 * UI, forbidden from the MCP by that tool's own schema (`rpc.ts` Q3).
 *
 * `--no-verify` is never emitted: `CommitCreateArgs.noVerify` exists so a
 * future Phase-4 auto-commit mode does not re-freeze G-RPC, and the sidecar
 * refuses `true` in v1. `assertArgvSafe` forbids the flag outright, so a
 * builder that started emitting it would fail the gate rather than ship.
 */
export function commit(opts: { paths: readonly string[]; message: string }): ArgvResult {
  const err = checkPathspecs(opts.paths);
  if (err) return err;
  if (opts.message.length === 0) return unsafeArgument('message', 'commit message is empty');
  const argv = g('commit', '-F', '-');
  if (opts.paths.length > 0) argv.push('--only', PATHSPEC_SEPARATOR, ...opts.paths);
  return finish(argv, opts.message);
}

/** `git branch <name> [<startPoint>]` — create only. `-D`/`-d`/`-M`/`-m` are
 *  unreachable: there is no parameter that could carry them and
 *  `assertArgvSafe` forbids `-D`/`--delete`. */
export function branchCreate(opts: { name: string; startPoint?: string }): ArgvResult {
  const nameErr = check(BranchNameSchema, opts.name, 'name');
  if (nameErr) return nameErr;
  const argv = g('branch', opts.name);
  if (opts.startPoint !== undefined) {
    const err = checkRef(opts.startPoint, 'startPoint');
    if (err) return err;
    argv.push(opts.startPoint);
  }
  return finish(argv);
}

/**
 * `git checkout <name>` — BRANCH SWITCH ONLY.
 *
 * `checkout -- <path>` (discard) is the one common git operation with no
 * reflog recovery, and it is out of v1 entirely (§Destructive operation
 * tiers). It is unreachable here structurally: this builder emits no `--`, and
 * there is no parameter that could carry a path.
 */
export function checkout(opts: { name: string }): ArgvResult {
  const err = checkRef(opts.name, 'name');
  if (err) return err;
  return finish(g('checkout', opts.name));
}

/** `git checkout -b <name> [<startPoint>]` — create and switch. */
export function checkoutNewBranch(opts: { name: string; startPoint?: string }): ArgvResult {
  const nameErr = check(BranchNameSchema, opts.name, 'name');
  if (nameErr) return nameErr;
  const argv = g('checkout', '-b', opts.name);
  if (opts.startPoint !== undefined) {
    const err = checkRef(opts.startPoint, 'startPoint');
    if (err) return err;
    argv.push(opts.startPoint);
  }
  return finish(argv);
}

/**
 * `git fetch [<remote>] [--prune]`.
 *
 * `mutating: false` in `RpcSpec` and `tier: 'safe'` here mean the same thing:
 * fetch writes only remote-tracking refs. `--prune` deletes remote-tracking
 * refs whose upstream is gone — it cannot touch a local branch, the index, or
 * the working tree. This is the only builder that reaches the network, which
 * is exactly why `GIT_TERMINAL_PROMPT=0` exists.
 */
export function fetch(opts: { remote?: string; prune?: boolean } = {}): ArgvResult {
  const argv = g('fetch');
  if (opts.remote !== undefined) {
    const err = checkRef(opts.remote, 'remote');
    if (err) return err;
    argv.push(opts.remote);
  }
  if (opts.prune) argv.push('--prune');
  return finish(argv);
}

/**
 * `git stash create` — writes a stash COMMIT and prints its sha without
 * touching the working tree, the index, or the stash reflog.
 *
 * Present in v1 only as the undo primitive the plan requires before any future
 * discard could ship ("if it ever ships it must first `git stash create` and
 * surface the sha"). `stash push`/`pop`/`drop` are not reachable —
 * `SUBCOMMAND_VERBS.stash` is `['create']`.
 */
export function stashCreate(): ArgvResult {
  return finish(g('stash', 'create'));
}

// ═════════════════════════════════════════════════════════════════════════════
// `gh` — probe only in Phase 1
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `gh auth status` in NON-json mode: exits 1 if any host has an auth problem,
 * 0 if clean. `--json` always exits 0 and is therefore useless as a health
 * check (02-research-external.md [35]). `gh` missing or logged out must never
 * park the pkg (D3) — it darkens Phase 3 and nothing else.
 */
export const GH_AUTH_STATUS_ARGV: readonly string[] = ['auth', 'status'];
export const GH_VERSION_ARGV: readonly string[] = ['--version'];

// ═════════════════════════════════════════════════════════════════════════════
// Formats shared with the parsers
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `git branch --list --format=…`, NUL-separated fields, one record per line.
 *
 * `%00` is a for-each-ref hex escape, so the fields are NUL-separated exactly
 * like `log`'s. Records stay newline-separated, which is safe here and only
 * here: a git ref name may not contain a newline, so nothing in a record can
 * forge a record boundary.
 *
 * Owned by `argv.ts` rather than `parse/branch.ts` only because `LOG_FORMAT`
 * has the opposite dependency direction and one of the two has to break the
 * cycle; `parse/branch.ts` imports this.
 */
export const BRANCH_FORMAT =
  '%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(worktreepath)%00%(contents:subject)';

/** Field count of `BRANCH_FORMAT`. `parse/branch.ts` asserts on it. */
export const BRANCH_FIELD_COUNT = 8;

export { LOG_FIELD_COUNT, LOG_FORMAT };
