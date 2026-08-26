/**
 * com.ikenga.git · git-core — child environment construction (G-16).
 *
 * The rule from `plans/git/01-plan.md` §Command construction rules, item 5:
 *
 *   > Child env is built **clear-first**: inherit the user's login env, drop
 *   > `IKENGA_*`, add `GIT_TERMINAL_PROMPT=0`. Never touch `GIT_ASKPASS`,
 *   > `SSH_AUTH_SOCK`, credential-helper or signing config — a denylist,
 *   > never an allowlist.
 *
 * "Clear-first" means we start from an EMPTY object and copy forward, rather
 * than mutating (or spreading-then-deleting) `process.env`. Spread-then-delete
 * looks equivalent and is not: a key added to `process.env` after the spread —
 * or a key whose name we forgot to delete — silently reaches the child. Build
 * up, never tear down.
 *
 * The asymmetry this creates is deliberate and is what verification 5 checks:
 *   · the sidecar/MCP process itself KEEPS `IKENGA_AUTH_TOKEN` (it needs the
 *     bridge), and
 *   · every `git`/`gh` GRANDCHILD it spawns does not.
 * The shell's own sidecar/MCP spawn sites have no denylist
 * (`lifecycle.rs:1076-1148`, `mcp_runtime.rs:91-98`) — memory
 * `reference_daemon_secrets_traps` records the same shape leaking a token into
 * every PTY the cron daemon spawned. This module is the only place that strip
 * happens for git-core, so it is the only place to get it right.
 */

/**
 * Env-name prefixes never forwarded to a git/gh child.
 *
 * `IKENGA_` covers `IKENGA_AUTH_TOKEN` (the localhost bridge bearer token),
 * `IKENGA_PKG_ID`, `IKENGA_PROJECT_ROOT` and anything the kernel adds later —
 * a prefix rule survives new variables, an exact list does not.
 */
export const ENV_DENY_PREFIXES: readonly string[] = ['IKENGA_'];

/**
 * Env names never forwarded, matched exactly.
 *
 * These are git's own *repository-targeting* variables. They are NOT auth or
 * signing config — dropping them changes nothing about credential helpers,
 * `GIT_ASKPASS`, `SSH_AUTH_SOCK`, `gpg.format` or `user.signingkey`.
 *
 * Why they must go: git-core targets a repo by spawning with `cwd = <repo>`.
 * If the process that launched the shell had `GIT_DIR` / `GIT_WORK_TREE` /
 * `GIT_INDEX_FILE` exported — routine inside a git hook, a `git rebase -x`
 * script, or a terminal where someone ran `export GIT_DIR=...` — those
 * override `cwd` for EVERY child. Every read would report the wrong repo and,
 * worse, `changes.stage` / `commit.create` would write into it. The cross-repo
 * staging guard (G-11) cannot catch that, because it compares pathspecs
 * against the toplevel git itself reports, and git would be reporting the
 * hijacked repo consistently.
 *
 * `GIT_CONFIG_*` are dropped for the same reason `-c` is never passed on argv:
 * `GIT_CONFIG_COUNT`/`_KEY_n`/`_VALUE_n` are ambient config injection, and
 * `core.sshCommand` / `core.pager` / `diff.external` set that way execute
 * programs. `GIT_CONFIG_GLOBAL`/`_SYSTEM` would silently discard the user's
 * real identity, which would defeat verification 4.
 */
export const ENV_DENY_EXACT: readonly string[] = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
];

/** Prefix form of the `GIT_CONFIG_COUNT`/`_KEY_n`/`_VALUE_n` triple. */
export const ENV_DENY_EXACT_PREFIXES: readonly string[] = ['GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_'];

/**
 * Names git-core sets on every child. Values are literal; nothing here is read
 * from the parent env.
 *
 * `GIT_TERMINAL_PROMPT=0`: a spawn that would otherwise block forever waiting
 * on a username/password at a terminal it does not have fails fast instead
 * (02-research-external.md [22]). Note the documented caveat: if the user has
 * `GIT_ASKPASS` set and it succeeds, git will use it and never reach the
 * terminal prompt — that is correct and intended, it is their credential path.
 */
export const ENV_FORCED: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
};

/**
 * Names that MUST survive into the child when the parent has them. Not an
 * allowlist — nothing consults this to decide what to copy. It exists so
 * `assertAuthEnvPreserved()` (and the env-asymmetry test) can state the
 * property in one place instead of restating it per call site.
 */
export const ENV_AUTH_PRESERVED: readonly string[] = [
  'SSH_AUTH_SOCK', // ssh-agent: SSH remotes AND ssh commit signing
  'GIT_ASKPASS', // user's askpass helper
  'SSH_ASKPASS',
  'GPG_TTY', // gpg signing
  'GNUPGHOME',
  'HOME', // ~/.gitconfig, ~/.ssh, credential stores
  'PATH', // resolving `git`, `gh`, and the user's credential helper
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR', // gnome-keyring / dbus credential stores
  'DBUS_SESSION_BUS_ADDRESS',
];

/** True when `name` must not be forwarded to a git/gh child. */
export function isDeniedEnvName(name: string): boolean {
  if (ENV_DENY_EXACT.includes(name)) return true;
  if (ENV_DENY_EXACT_PREFIXES.some((p) => name.startsWith(p))) return true;
  return ENV_DENY_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Build the environment for a `git` / `gh` child, clear-first.
 *
 * @param parent  Source env. Defaults to `process.env`; injectable so the
 *                asymmetry test can drive a synthetic parent without mutating
 *                the test runner's own environment.
 * @param extra   Additional variables to set AFTER the forced ones. Used only
 *                for genuinely per-call values; nothing in v1 passes it.
 */
export function buildChildEnv(
  parent: NodeJS.ProcessEnv = process.env,
  extra: Readonly<Record<string, string>> = {}
): Record<string, string> {
  // Clear-first: start empty, copy forward what survives the denylist.
  const out: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const name of Object.keys(parent)) {
    const value = parent[name];
    if (value === undefined) continue; // an unset key, not an empty one
    if (isDeniedEnvName(name)) continue;
    out[name] = value;
  }

  for (const [name, value] of Object.entries(ENV_FORCED)) out[name] = value;
  for (const [name, value] of Object.entries(extra)) out[name] = value;

  return out;
}

/**
 * Assert the two halves of G-16 on a built env. Throws with a precise message
 * rather than returning a boolean — a violation here is a security regression,
 * not a condition to branch on.
 *
 * Called by the env test and available to WP-04/WP-05 as a boot self-check.
 */
export function assertChildEnvSafe(
  child: Readonly<Record<string, string>>,
  parent: NodeJS.ProcessEnv = process.env
): void {
  for (const name of Object.keys(child)) {
    if (isDeniedEnvName(name)) {
      throw new Error(`G-16 violation: denied env name "${name}" reached the child`);
    }
  }
  if (child['GIT_TERMINAL_PROMPT'] !== '0') {
    throw new Error('G-16 violation: GIT_TERMINAL_PROMPT is not "0" in the child env');
  }
  for (const name of ENV_AUTH_PRESERVED) {
    const want = parent[name];
    if (want === undefined) continue; // parent does not have it; nothing to preserve
    if (child[name] !== want) {
      throw new Error(`G-16 violation: auth-critical env "${name}" was not preserved`);
    }
  }
}
