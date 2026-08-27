/**
 * com.ikenga.git · **git-core** — the shared library (WP-03).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Git on disk is the single owner of repo state. Every in-process model is  │
 * │ a cache over it (G-03).                                                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * That sentence is why this is a LIBRARY and not a process. The pkg runs two
 * processes that both need git — a one-shot sidecar spawned per
 * `host.pkgSidecarCall` (WP-04) and a long-lived supervised MCP that also owns
 * the fs-watcher (WP-05) — plus the MCP is registered into `~/.claude.json`
 * and can be launched by any `claude` session on the machine. Three callers,
 * one set of rules; a process would have had to be a fourth participant in a
 * consistency problem that git already solves.
 *
 * ── What lives where ────────────────────────────────────────────────────────
 *
 *   `rpc.ts`      THE FROZEN CONTRACT (G-RPC). A byte-verbatim copy of
 *                 `plans/git/drafts/rpc.ts`. Do not edit it here — edit the
 *                 draft, re-copy, and record the change in `04-discussion.md`.
 *                 Methods, arg/result Zod schemas, the 20-reason error union,
 *                 the G-MCP tool surface, `repo.changed` notification params.
 *
 *   `argv.ts`     THE CONTAINMENT BOUNDARY (G-02). Subcommand allowlist,
 *                 structured builders that emit `string[]`, `--` before every
 *                 pathspec, `^-` rejection, forbidden-flag rescan. The manifest
 *                 allowlist fires only at kernel spawn; once the sidecar runs,
 *                 THIS is the sandbox.
 *
 *   `env.ts`      G-16. Clear-first child env: `IKENGA_*` stripped,
 *                 `GIT_TERMINAL_PROMPT=0` forced, `SSH_AUTH_SOCK` /
 *                 `GIT_ASKPASS` / credential helpers / signing config
 *                 untouched, so the user's own auth and signature just work
 *                 with zero credential code in this pkg.
 *
 *   `exec.ts`     The single spawn primitive. `shell: false`, always; a
 *                 deadline, always; `buildChildEnv()`, always.
 *
 *   `staged.ts`   G-04. The explicit-path commit ASSERTION. `git commit`
 *                 records the index; the caller's path list is checked against
 *                 the staged set and refused on any difference
 *                 (`staged-set-mismatch`) rather than turned into a pathspec —
 *                 a pathspec commits the WORKING TREE and would silently
 *                 record unreviewed edits (rpc.ts DELTA 7).
 *
 *   `discover.ts` G-11 / G-05. Root resolution onto the four no-root states,
 *                 the bounded nested-repo scan, and the ownership primitive
 *                 behind the cross-repo staging guard.
 *
 *   `parse/*`     Pure porcelain parsers. No spawning, no filesystem.
 *
 *   `errors.ts`   Construction and classification for the frozen error
 *                 vocabulary, plus credential redaction.
 *
 * ── The invariant worth restating ───────────────────────────────────────────
 *
 * Nothing in git-core throws for an expected condition. "No project", "no
 * project root", "not a repository", "unreadable", "another process holds the
 * index lock", "gh is not installed" are all VALUES — named members of
 * `GitErrorReason` — because each one is a UI state someone has to render.
 * Exceptions are reserved for programmer error.
 */

// ── The frozen contract, re-exported so consumers have one import ───────────
export * from './rpc.js';

// ── Command construction (G-02) ─────────────────────────────────────────────
export * as argv from './argv.js';
export {
  ALLOWED_SUBCOMMANDS,
  BRANCH_FIELD_COUNT,
  BRANCH_FORMAT,
  FORBIDDEN_ARG_PREFIXES,
  GH_AUTH_STATUS_ARGV,
  GH_VERSION_ARGV,
  GLOBALS,
  PATCH_SAFETY,
  PATHSPEC_SEPARATOR,
  SUBCOMMAND_VERBS,
  assertArgvSafe,
  checkPathspecs,
  checkRef,
  type AllowedSubcommand,
  type ArgvResult,
  type RevParseQuery,
} from './argv.js';

// ── Environment (G-16) ──────────────────────────────────────────────────────
export {
  ENV_AUTH_PRESERVED,
  ENV_DENY_EXACT,
  ENV_DENY_EXACT_PREFIXES,
  ENV_DENY_PREFIXES,
  ENV_FORCED,
  assertChildEnvSafe,
  buildChildEnv,
  isDeniedEnvName,
} from './env.js';

// ── Spawning ────────────────────────────────────────────────────────────────
export {
  DEFAULT_MAX_BUFFER,
  DEFAULT_TIMEOUT_MS,
  NETWORK_TIMEOUT_MS,
  exec,
  expectSuccess,
  run,
  runTolerant,
  spawnChild,
  type Binary,
  type ExecOutcome,
  type ExecResult,
  type SpawnOptions,
} from './exec.js';

// ── Discovery (G-11 / G-05) ─────────────────────────────────────────────────
export {
  assertPathsOwnedBy,
  describeNested,
  findToplevel,
  isIgnoredByParent,
  isInside,
  ownerRepoOf,
  readGitmodulePaths,
  resolveProjectRoot,
  scanForRepos,
  type ScanOptions,
  type ScanResult,
} from './discover.js';

// ── Explicit-path commit assertion (G-04) ───────────────────────────────────
export {
  assertStagedSetMatches,
  compareStagedSet,
  normalizeRelPath,
  readStagedPaths,
  type StagedSetDiff,
} from './staged.js';

// ── Errors ──────────────────────────────────────────────────────────────────
export {
  classifyGitFailure,
  crossRepoPath,
  firstLine,
  fromGitFailure,
  fromZodError,
  gitError,
  notAllowed,
  redact,
  trimStderr,
  unsafeArgument,
  type GitErrorExtra,
} from './errors.js';

// ── Parsers ─────────────────────────────────────────────────────────────────
export * from './parse/index.js';
