// DRAFT-FOR: ikenga-pkgs/packages/apps/git/core/src/rpc.ts (WP-03, copied into
//            sidecar/ + mcp/ + ui/ as the single shared contract)
// Built fresh in Round 3 — see 01-plan.md §Architecture, §Shared state contract,
// §Command construction rules, §MCP threat model, §Destructive operation tiers.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS FILE IS THE **G-RPC** FREEZE-GATE ARTEFACT.
//
// It is frozen when: it typechecks, AND a sidecar stub AND a UI mock both
// compile against it (05-tracking.md §WP-01 DoD). After that, changing a
// method name, an arg shape, a result shape, an error reason, or the
// notification surface is a cross-WP re-sync (WP-04 sidecar + WP-05 MCP +
// WP-06 UI all consume it) and must be recorded in 04-discussion.md.
//
// Consumers, in dependency order:
//   WP-03  git-core  — owns the argv/env/parse layer these shapes describe
//   WP-04  sidecar   — implements `RpcSpec` dispatch + emits `repo.changed`
//   WP-05  MCP       — exposes exactly the `mcp:` tools named below, no more
//   WP-06  UI        — mocks `RpcSpec` until WP-04 lands
//   WP-12  shell     — forwards `repo.changed` into the iframe (AppBridge)
// ─────────────────────────────────────────────────────────────────────────────
//
// Round-by-round changes:
//   - Round 3: built fresh (WP-01). Divergences from the studio precedent and
//     refinements beyond 01-plan.md are listed under "DELTAS" below.
//   - Round 6: MINIMAL G-RPC REOPEN (WP-10 fix). ONE added error reason —
//     `staged-set-mismatch` (DELTA 7). Nothing else changed: no method name,
//     no arg shape, no result shape, no notification. Adding a member to the
//     reason union is additive for producers and forces no consumer change
//     (every consumer already renders `GitError.message` for reasons it does
//     not special-case), so the re-sync is: git-core (produces it), sidecar +
//     MCP (call the assertion), UI (renders the message it already renders).
//
// DELTAS vs 01-plan.md / the studio precedent — read before landing:
//   1. Error key is `reason`, NOT studio's `error` (`sidecars/project/src/
//      rpc-types.ts:9`). 01-plan.md §Freeze gates specifies `{ok:false, reason}`
//      verbatim; the plan wins. Do not "align with studio" later — that is a
//      contract break.
//   2. The three hand-maintained registration places in studio (dispatch case +
//      `RpcMethod` union + `EXTENDED_METHODS` Set — `rpc.ts:128,228`) collapse
//      to ONE here: `RpcSpec` is `satisfies Record<RpcMethod, MethodSpec>`, so
//      omitting a method is a compile error and inventing one is a compile
//      error. The dispatch switch is still hand-written but is exhaustiveness-
//      checked by `assertNever`. See §REGISTRATION CHECKLIST.
//   3. `ProjectRollup.rootIsRepo` is new. 01-plan.md G-05 lists four no-root
//      states but does not cover "project root is not a repo yet DOES contain
//      nested repos" — real for a projects dir that is not itself a clone. Rule
//      encoded here: not-a-repo + zero nested ⇒ `not-a-repository`; not-a-repo
//      + ≥1 nested ⇒ `ok` with `rootIsRepo: false`.
//   4. `repo.init` is DELIBERATELY ABSENT even though G-05 state (c) says
//      "offer `git init`". `init` is not on the git-core subcommand allowlist
//      (01-plan.md §Command construction rules, rule 1) and adding it widens
//      the write surface for one empty-state affordance. Until that is decided,
//      the "not a repository" state offers a copyable command, not an RPC.
//      Flagged as an open question for the orchestrator.
//   5. Pathspec/ref hardening (rule 3 — reject `^-`) is enforced HERE, in the
//      Zod schemas, not only inside git-core. Both the sidecar and the MCP get
//      option-injection rejection for free at the parse boundary, and both must
//      classify the failure through `reasonForParseFailure` so an injection
//      attempt reads as `unsafe-argument` rather than being flattened into
//      `invalid-args` (that flattening is what verification 6 would miss).
//      git-core still re-checks: defence in depth, and git-core is used by
//      tests that bypass RPC entirely.
//   6. `stash.*`, `gh.*` PR verbs, and every entry in `NEVER_EXPOSE` are absent
//      by construction — absence IS the enforcement (01-plan.md §MCP threat
//      model).
//   7. `staged-set-mismatch` (R6). 01-plan.md §MCP threat model says
//      `git_commit` "commits only the explicit path list", and the first
//      implementation read that as `git commit --only -- <paths>`. That is
//      WRONG in a way that loses data: with a pathspec, `commit` records the
//      WORKING TREE content of those paths and ignores the index, so a file
//      staged at revision B1 and then edited to B2 in the editor commits B2 —
//      the user commits something they never reviewed, and the pkg's own
//      staged-diff view was a lie. The contract is now: `commit` records the
//      INDEX (`git commit -F -`, no pathspec), and "explicit paths" is an
//      ASSERTION — the staged set must EQUAL the requested set, or this reason
//      comes back with nothing committed. Same containment promise ("commits
//      nothing implicitly"), enforced by refusing rather than by narrowing.

import { z } from 'zod';

// ═════════════════════════════════════════════════════════════════════════════
// 0 · TRANSPORT — how the three consumers actually reach the sidecar
// ═════════════════════════════════════════════════════════════════════════════
//
// Two framings over ONE method surface. Neither is negotiable at the WP level;
// they are what the shell actually exposes today.
//
// (a) UI iframe → sidecar. `host.pkgSidecarCall` is the ONLY sidecar verb a pkg
//     iframe can reach (`shell/src/components/pkg/pkg-iframe-host.tsx:359-370`;
//     the streaming `pkg_sidecar_rpc_send` path has no `host.*` verb). It is
//     ONE-SHOT: spawn, write stdin, read stdout, exit. So:
//
//       app.callServerTool({
//         name: 'host.pkgSidecarCall',
//         arguments: {
//           sidecar: SIDECAR_NAME,
//           args: [ONESHOT_ARGV],           // ['rpc']
//           stdin: JSON.stringify(request), // one RpcRequest
//           timeoutSecs: 20,
//         },
//       })  // → res.structuredContent === RpcResponse
//
//     Because every UI call is a fresh process, the in-memory cache lives in
//     the SUPERVISED instance, not the one-shot one; the one-shot path either
//     reads git directly or asks the supervised instance. That choice is
//     WP-04's, and it is why `RepoSnapshot` carries `capturedAt`/`stale`
//     rather than the caller assuming freshness.
//
// (b) Kernel-supervised long-lived instance (`manifest.sidecars[]`, stdio
//     "json") speaks line-delimited JSON-RPC 2.0 on stdin/stdout — the studio
//     framing (`sidecars/project/src/rpc.ts`). This is the ONLY thing that
//     emits `repo.changed` notifications, which the shell FE observes as
//     `pkgSidecarMessageEvent(pkgId, name)` (`shell/src/lib/tauri-cmd.ts:3035`)
//     and WP-12 forwards into the iframe.
//
// Logs ALWAYS go to stderr. A stray `console.log` corrupts both framings.

/** Manifest sidecar name. Must start with `pa-<slug>-` where slug = pkg id with
 *  `.` → `-` (`contract/src/manifest.ts:49`, `expectedSidecarPrefix`). */
export const SIDECAR_NAME = 'pa-com-ikenga-git-repo' as const;

/** Pkg id — the `repo.changed` forwarder (WP-12) scopes by this. */
export const PKG_ID = 'com.ikenga.git' as const;

/** argv the one-shot invocation passes; the request itself rides on stdin so no
 *  path, ref or message is ever exposed to argv quoting. */
export const ONESHOT_ARGV = ['rpc'] as const;

// ═════════════════════════════════════════════════════════════════════════════
// 1 · ERROR SHAPE — `{ ok: false, reason }` (01-plan.md §Freeze gates)
// ═════════════════════════════════════════════════════════════════════════════
//
// Every failure the pkg can produce is one of these. A raw git stderr string is
// NEVER the error — it rides in `stderr` on the `git-failed` branch so the UI
// can render a named state and still show the truth in a details disclosure.

export const GIT_ERROR_REASONS = [
  // ── G-05 no-root states. All four are named UI states, never a throw and
  //    never a failed git spawn (01-plan.md §Shared state contract).
  /** (a) no active project, or `royaltiSuite.activeProject` absent entirely
   *      (older shell / pre-handshake). */
  'no-project',
  /** (b) active project exists but `root` is null — the seed Default project,
   *      or a skill-only project. */
  'no-project-root',
  /** (c) root is readable but is not a git repo AND contains no nested repos. */
  'not-a-repository',
  /** (d) root (or a path under it) cannot be read — permissions, dead symlink,
   *      unmounted volume. */
  'unreadable',

  // ── G-04 MCP containment. The MCP runs outside the shell with no kernel
  //    gate; every tool resolves `repo` against the projects table's known
  //    roots and refuses outside them.
  /** `repo` is not inside any known project root. */
  'repo-not-known',

  // ── G-11 multi-repo guard.
  /** Path belongs to a different toplevel than the target repo. Carries
   *  `path` + `ownerRepo` so the UI can offer "stage it there" as a jump. */
  'cross-repo-path',

  // ── G-04 explicit-path commit (DELTA 7).
  /** The repo's staged set is not exactly the requested path set, so
   *  committing would record content the caller did not name — either extra
   *  staged paths that would be swept in, or requested paths that are not
   *  staged at all. `message` lists both sides. NOTHING was committed: this
   *  is asserted BEFORE `git commit` runs, never repaired by narrowing the
   *  commit, because narrowing is what `--only` did and `--only` commits the
   *  WORKING TREE of the named paths rather than their index content. */
  'staged-set-mismatch',

  // ── G-02 command construction.
  /** Arg failed Zod parse. */
  'invalid-args',
  /** A pathspec/ref that would be read as an option (`^-`), or contains NUL,
   *  or escapes the repo. Option injection — `--upload-pack`, `--receive-pack`,
   *  `-c core.sshCommand` all execute programs. */
  'unsafe-argument',
  /** Subcommand is not on git-core's hardcoded allowlist. Should be
   *  unreachable from a typed caller; it exists so the git-core boundary has
   *  something to return rather than throwing. */
  'not-allowed',

  // ── G-12 destructive tiers.
  /** Operation would lose uncommitted work; caller must re-issue with the
   *  method's explicit confirm flag. */
  'confirm-required',
  /** Working tree is dirty in a way the operation cannot proceed through even
   *  with confirmation (e.g. conflicted paths). */
  'dirty-tree',

  // ── G-13 concurrency with the user's own agents.
  /** `.git/index.lock` still held after bounded backoff. The UI copy is
   *  "another process is writing to this repo — retrying", never a raw error. */
  'index-locked',
  /** A merge/rebase/cherry-pick/bisect is in progress; the operation is
   *  refused rather than half-applied. */
  'operation-in-progress',

  // ── Environment.
  /** `git` not found on PATH. */
  'git-missing',
  /** `gh` not found on PATH — Phase 3 dark; must NEVER park the pkg (D3). */
  'gh-missing',
  /** `gh auth status` exited non-zero (non-JSON mode; `--json` always exits 0
   *  — 02-research-external.md [35]). */
  'gh-unauthenticated',

  // ── Fall-throughs.
  /** git ran and exited non-zero. `exitCode` + `stderr` carry the detail. */
  'git-failed',
  /** The spawn exceeded its deadline (includes a credential prompt that would
   *  have hung — `GIT_TERMINAL_PROMPT=0` should turn most of these into
   *  `git-failed` instead). */
  'timeout',
  /** Anything else. Always logged to stderr with a stack. */
  'internal',
] as const;

export const GitErrorReasonSchema = z.enum(GIT_ERROR_REASONS);
export type GitErrorReason = z.infer<typeof GitErrorReasonSchema>;

export const GitErrorSchema = z.object({
  ok: z.literal(false),
  reason: GitErrorReasonSchema,
  /** Human-readable, already-safe to render. Never contains a credential; the
   *  sidecar redacts before constructing this. */
  message: z.string(),
  /** `git-failed` only. */
  exitCode: z.number().int().nullable().optional(),
  /** `git-failed` only — trimmed to `MAX_STDERR_CHARS`, shown behind a details
   *  disclosure, never in the primary error line. */
  stderr: z.string().nullable().optional(),
  /** `cross-repo-path` / `unsafe-argument` — the offending path or ref. */
  path: z.string().nullable().optional(),
  /** `cross-repo-path` — the toplevel that actually owns `path`, so the UI can
   *  offer a jump instead of a dead end. */
  ownerRepo: z.string().nullable().optional(),
  /** `index-locked` — how many retries were spent before giving up. */
  retries: z.number().int().nonnegative().optional(),
});
export type GitError = z.infer<typeof GitErrorSchema>;

export const MAX_STDERR_CHARS = 2000;

/** Build an `{ ok: true, ... } | GitError` discriminated union from the success
 *  shape. Every method result in `RpcSpec` goes through this — that is what
 *  makes `{ok:false, reason}` structural rather than a convention. */
function rpcResult<S extends z.ZodRawShape>(shape: S) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), ...shape }),
    GitErrorSchema,
  ]);
}

/** Narrowing helper for consumers. */
export function isGitError(v: { ok: boolean }): v is GitError {
  return v.ok === false;
}

// ═════════════════════════════════════════════════════════════════════════════
// 2 · HARDENED PRIMITIVES — G-02 rule 3, enforced at the parse boundary
// ═════════════════════════════════════════════════════════════════════════════

const NUL = '\u0000';

/**
 * Marker prefixed to every HARDENING refinement message below, so a Zod parse
 * failure can be classified without string-sniffing the individual rules.
 *
 * Why this matters: a caller that maps every parse failure to `invalid-args`
 * loses the distinction between "you sent a number where a string goes" and
 * "you sent `--upload-pack=touch /tmp/pwn`". Verification 6 asserts on the
 * SECOND one, and an audit trail should show attempted option injection as its
 * own reason. Both the sidecar and the MCP must classify through
 * `reasonForParseFailure` so they agree on which is which.
 */
const UNSAFE = 'unsafe: ';

/** Map a Zod failure on an args schema onto the frozen error vocabulary.
 *  Any issue raised by a hardening refinement (G-02 rule 3) ⇒
 *  `unsafe-argument`; anything else (wrong type, missing field, unknown key)
 *  ⇒ `invalid-args`. */
export function reasonForParseFailure(
  issues: readonly { message: string }[]
): Extract<GitErrorReason, 'unsafe-argument' | 'invalid-args'> {
  return issues.some((i) => i.message.startsWith(UNSAFE)) ? 'unsafe-argument' : 'invalid-args';
}

/** Dotted path of the first hardening-rule failure, for `GitError.path`. */
export function offendingPath(
  issues: readonly { message: string; path: readonly (string | number)[] }[]
): string | null {
  const hit = issues.find((i) => i.message.startsWith(UNSAFE));
  return hit ? hit.path.join('.') : null;
}

/** Absolute path of a repository toplevel (`git rev-parse --show-toplevel`).
 *  This is the `repo` every RPC method and every MCP tool takes explicitly —
 *  there is no ambient "current repo" anywhere in this contract. */
export const RepoPathSchema = z
  .string()
  .min(1)
  .refine((s) => !s.includes(NUL), { message: UNSAFE + 'path contains NUL' })
  .refine((s) => s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s), {
    message: UNSAFE + 'repo must be an absolute path (POSIX or Windows drive)',
  });

/** A repo-RELATIVE pathspec. Rejected: leading `-` (option injection), NUL,
 *  absolute paths, and `..` traversal. `--` is still emitted before every
 *  pathspec on the argv side — this schema is the first of two gates, not the
 *  only one. */
export const PathspecSchema = z
  .string()
  .min(1)
  .refine((s) => !s.startsWith('-'), {
    message: UNSAFE + 'pathspec may not start with "-" (option injection)',
  })
  .refine((s) => !s.includes(NUL), { message: UNSAFE + 'pathspec contains NUL' })
  .refine((s) => !s.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(s), {
    message: UNSAFE + 'pathspec must be repo-relative',
  })
  .refine((s) => !s.split(/[\\/]/).includes('..'), {
    message: UNSAFE + 'pathspec may not traverse upward',
  });

/** A git ref / revision (branch, tag, sha, `main...HEAD`). Same `^-` rejection;
 *  refs additionally may not contain whitespace or the ref-format-illegal
 *  sequences that would let a ref masquerade as two argv words. */
export const RefSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.startsWith('-'), {
    message: UNSAFE + 'ref may not start with "-" (option injection)',
  })
  .refine((s) => !/[\s\u0000~^:?*[\\\x7f]/.test(s), {
    message: UNSAFE + 'ref contains an illegal character',
  });

/** Branch name for create/checkout. Stricter than `RefSchema`: no `..`, no
 *  trailing `.lock`, no leading/trailing slash. */
export const BranchNameSchema = RefSchema.refine(
  (s) => !s.includes('..') && !s.endsWith('.lock') && !s.startsWith('/') && !s.endsWith('/'),
  { message: UNSAFE + 'invalid branch name' }
);

/** 40-char (or abbreviated ≥7) hex object id. */
export const ShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/, 'not an object id');

/** Commit message. Multi-line allowed (trailers matter — `Co-Authored-By`).
 *  Passed via `-F -` on stdin, never as an argv value. */
export const CommitMessageSchema = z.string().min(1).max(64 * 1024);

// ═════════════════════════════════════════════════════════════════════════════
// 3 · DOMAIN TYPES
// ═════════════════════════════════════════════════════════════════════════════

// ── 3.1 Status codes ────────────────────────────────────────────────────────
// From `git status --porcelain=v2 --branch -z` (02-research-external.md [17]).
// `-z` gives NUL-terminated UNQUOTED paths — the only sane parse mode.

/** One half of the porcelain-v2 `<XY>` field. `.` means "unchanged on this
 *  side". `?` untracked, `!` ignored appear only as whole-entry kinds. */
export const GitStatusCodeSchema = z.enum([
  '.', // unmodified on this side
  'M', // modified
  'T', // file-type changed (regular/symlink/submodule)
  'A', // added
  'D', // deleted
  'R', // renamed
  'C', // copied
  'U', // updated but unmerged
]);
export type GitStatusCode = z.infer<typeof GitStatusCodeSchema>;

export const ChangeKindSchema = z.enum([
  'ordinary', // porcelain-v2 `1` line
  'renamed', // `2` line, X === 'R'
  'copied', // `2` line, X === 'C'
  'unmerged', // `u` line
  'untracked', // `?` line
  'ignored', // `!` line — only surfaced when explicitly requested
]);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const FileChangeSchema = z.object({
  /** Repo-relative, unquoted (courtesy of `-z`). */
  path: z.string(),
  /** Rename/copy source; null otherwise. */
  origPath: z.string().nullable(),
  kind: ChangeKindSchema,
  /** Index side of `<XY>` — what `commit` would record. */
  staged: GitStatusCodeSchema,
  /** Worktree side of `<XY>` — what `commit` would NOT record. */
  unstaged: GitStatusCodeSchema,
  /** Rename/copy similarity score (the `R100` / `C75` suffix), else null. */
  score: z.number().int().min(0).max(100).nullable(),
  /** porcelain-v2 `<sub>` field: `N...` for a non-submodule, else `S<c><m><u>`. */
  submodule: z.string().nullable(),
  /** From `--numstat`. `null` on both when the file is binary — git reports
   *  `-\t-\t<path>`, which is NOT the same as `0/0` (02-research [20]). */
  added: z.number().int().nonnegative().nullable(),
  deleted: z.number().int().nonnegative().nullable(),
  binary: z.boolean(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

// ── 3.2 Worktrees ───────────────────────────────────────────────────────────
// From `git worktree list --porcelain -z` (02-research-external.md [18]).

export const WorktreeInfoSchema = z.object({
  /** Absolute path. Always the first attribute of a porcelain record. */
  path: z.string(),
  head: ShaSchema.nullable(),
  /** Full ref (`refs/heads/foo`) or null when detached/bare. */
  branch: z.string().nullable(),
  detached: z.boolean(),
  bare: z.boolean(),
  locked: z.boolean(),
  /** Reason text when `locked <reason>` carried one; null for a bare `locked`. */
  lockReason: z.string().nullable(),
  /** Useful for flagging stale agent worktrees in Phase 2. */
  prunable: z.boolean(),
  prunableReason: z.string().nullable(),
  /** True for the first record — the main working tree, not a linked one. */
  isMain: z.boolean(),
  /** Phase 2 (`WorktreeOwner`): the terminal that owns this worktree, joined on
   *  `TerminalDescriptor.cwd` × `terminal_id` (`shell/src-tauri/src/pty/mod.rs`
   *  :243-263). ALWAYS `null` in Phase 1 — the field exists so P2 does not
   *  re-freeze G-RPC. Key on `terminal_id`, NEVER on `label` (duplicate-label
   *  race, memory `project_terminal_label_race`). */
  ownerTerminalId: z.string().nullable(),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

// ── 3.3 Nested repos ────────────────────────────────────────────────────────
// The ikenga workspace is a root meta-repo + independent nested clones (NOT
// submodules). `.gitmodules` is read but submodules are out of v1 scope (D2).

export const NestedRepoSchema = z.object({
  /** Absolute toplevel of the nested repo. */
  repo: RepoPathSchema,
  /** Path relative to the PARENT repo's toplevel — what the UI indents by. */
  relPath: z.string(),
  /** Last path segment; the UI's short label (`shell`, `contract`, …). */
  name: z.string(),
  /** Directory levels below the parent toplevel. 1 for `shell/`. */
  depth: z.number().int().positive(),
  /** True when this path also appears in the parent's `.gitmodules`. Read-only
   *  signal in v1 — submodule operations are not implemented. */
  isSubmodule: z.boolean(),
  /** True when the parent's `.gitignore` excludes it (the ikenga case: the
   *  workspace is gitignored from the royalti-co monorepo). Explains "why is
   *  this repo invisible to its parent" in the UI. */
  ignoredByParent: z.boolean(),
});
export type NestedRepo = z.infer<typeof NestedRepoSchema>;

// ── 3.4 Commits ─────────────────────────────────────────────────────────────
// From `git log --format=...%x00...` — NUL-delimited because NUL cannot appear
// in any field, unlike commas/pipes/tabs (02-research-external.md [19]).

export const CoAuthorSchema = z.object({
  name: z.string(),
  email: z.string(),
});
export type CoAuthor = z.infer<typeof CoAuthorSchema>;

export const CommitSummarySchema = z.object({
  sha: ShaSchema,
  /** `%h`. */
  shortSha: z.string(),
  /** `%P` split on space — [] for a root commit, 2+ for a merge. This is what
   *  WP-08's hand-rolled forbidden-columns layout consumes. */
  parents: z.array(ShaSchema),
  authorName: z.string(),
  authorEmail: z.string(),
  /** `%at` — author time, epoch SECONDS. */
  authorAt: z.number().int(),
  committerName: z.string(),
  committerEmail: z.string(),
  /** `%ct` — commit time, epoch SECONDS. Sort key for the graph. */
  committedAt: z.number().int(),
  /** `%s`. */
  subject: z.string(),
  /** `%D` decorations, split — `HEAD -> main`, `origin/main`, tags. */
  refs: z.array(z.string()),
  /** Parsed from the `Co-Authored-By:` trailers of `%B`. Empty array means the
   *  trailer is absent — which is a REAL case, not an error: the attribution
   *  string is user-configurable and can be suppressed
   *  (02-research-external.md [27][28]). The History view must render both. */
  coAuthors: z.array(CoAuthorSchema),
});
export type CommitSummary = z.infer<typeof CommitSummarySchema>;

export const CommitDetailSchema = CommitSummarySchema.extend({
  /** `%B` — raw body including trailers. */
  body: z.string(),
  /** Parsed `Key: value` trailers, in order. Includes the co-author lines. */
  trailers: z.array(z.object({ key: z.string(), value: z.string() })),
  /** Per-file numstat for this commit (vs its first parent). */
  files: z.array(FileChangeSchema),
  /** From `%G?` when the repo signs. `null` when unsigned or not requested —
   *  the pkg never configures signing itself; if the user has
   *  `commit.gpgsign=true` the inherited-env spawn signs on its own
   *  (02-research-external.md [25][26]). */
  signature: z
    .object({
      /** `%G?`: G good · B bad · U good-untrusted · X expired · Y expired-key ·
       *  R revoked · E cannot-check · N none. */
      status: z.string(),
      signer: z.string().nullable(),
    })
    .nullable(),
});
export type CommitDetail = z.infer<typeof CommitDetailSchema>;

// ── 3.5 Branches ────────────────────────────────────────────────────────────

export const BranchInfoSchema = z.object({
  /** Short name (`main`, `feat/x`). */
  name: z.string(),
  /** Full ref (`refs/heads/main`, `refs/remotes/origin/main`). */
  fullRef: z.string(),
  isHead: z.boolean(),
  isRemote: z.boolean(),
  /** Configured upstream short ref, or null when unset — the `shell/` repo in
   *  the design spec is a real "no upstream" case. */
  upstream: z.string().nullable(),
  /** vs `upstream`. Both null when there is no upstream. */
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  lastCommit: CommitSummarySchema.nullable(),
  /** Set when this branch is checked out in a LINKED worktree — checking it
   *  out here would fail, so the UI must disable rather than let git error. */
  worktreePath: z.string().nullable(),
});
export type BranchInfo = z.infer<typeof BranchInfoSchema>;

// ── 3.6 Repo snapshot — the shared-state row of 01-plan.md ───────────────────

/** In-progress sequenced operation, read from `.git` state files. Guards the
 *  commit box: committing mid-rebase is not a thing the UI should offer. */
export const RepoOperationSchema = z.enum([
  'none',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'bisect',
]);
export type RepoOperation = z.infer<typeof RepoOperationSchema>;

export const RepoSnapshotSchema = z.object({
  /** Absolute toplevel — the identity of this repo everywhere in the contract. */
  repo: RepoPathSchema,
  /** Last path segment of `repo`. */
  name: z.string(),
  /** Relative to the PROJECT root (`.` for the root repo, `shell` for a child).
   *  Purely for display ordering/indentation. */
  relPath: z.string(),
  /** `git rev-parse --git-dir`, absolutised. For a linked worktree this is
   *  `<main>/.git/worktrees/<name>`, which is how the UI can tell it is looking
   *  at a worktree rather than the main tree. */
  gitDir: z.string(),
  isBare: z.boolean(),

  headSha: ShaSchema.nullable(), // null on an unborn branch (`(initial)`)
  /** Short branch name, or null when detached. */
  branch: z.string().nullable(),
  detached: z.boolean(),
  /** `# branch.upstream` — present only when set. */
  upstream: z.string().nullable(),
  /** `# branch.ab +A -B` — present only when an upstream is set, so BOTH are
   *  null for `shell/`-style no-upstream repos. For an arbitrary base (worktree
   *  branch vs `main`) use `repo.aheadBehind` instead (02-research [21]). */
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),

  /** Counts, not lists — the file lists come from `changes.list`. Keeping the
   *  snapshot small is what makes the project rollup cheap on 8 repos. */
  staged: z.number().int().nonnegative(),
  unstaged: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
  conflicted: z.number().int().nonnegative(),
  /** `# stash <N>` from `--show-stash`. */
  stashCount: z.number().int().nonnegative(),

  operation: RepoOperationSchema,
  lastCommit: CommitSummarySchema.nullable(),
  worktrees: z.array(WorktreeInfoSchema),
  nested: z.array(NestedRepoSchema),

  /** Epoch MILLISECONDS the snapshot was taken. Every consumer of a cached
   *  snapshot renders relative to this rather than assuming "now". */
  capturedAt: z.number().int(),
  /** True when served from cache past its TTL because a fresh read was
   *  in-flight or the repo was locked. The UI dims rather than lying. */
  stale: z.boolean(),
});
export type RepoSnapshot = z.infer<typeof RepoSnapshotSchema>;

// ── 3.7 Project rollup ──────────────────────────────────────────────────────

export const ProjectRollupSchema = z.object({
  /** The project root that was scanned (absolute). */
  root: z.string(),
  /** False when `root` itself is not a git repo but nested repos were found —
   *  see DELTA 3. `not-a-repository` is returned instead when there are none. */
  rootIsRepo: z.boolean(),
  /** Root repo first (when `rootIsRepo`), then nested repos by `relPath`. */
  repos: z.array(RepoSnapshotSchema),
  /** Scan hit `MAX_SCAN_DEPTH` or `MAX_REPOS` and stopped. The UI says so
   *  rather than silently showing a partial workspace. */
  truncated: z.boolean(),
  capturedAt: z.number().int(),
});
export type ProjectRollup = z.infer<typeof ProjectRollupSchema>;

/** Discovery bounds — a project root is user-chosen and could be `$HOME`. */
export const MAX_SCAN_DEPTH = 4;
export const MAX_REPOS = 64;
/** Never descend into these while hunting for nested `.git` dirs. */
export const SCAN_SKIP_DIRS = [
  'node_modules',
  '.pnpm',
  'target',
  'dist',
  'build',
  '.venv',
  'vendor',
  '.cache',
  '.next',
] as const;

// ── 3.8 Diff ────────────────────────────────────────────────────────────────

export const DiffSideSchema = z.enum([
  'staged', // `git diff --cached -- <path>`
  'unstaged', // `git diff -- <path>`
  'commit', // `git show <sha> -- <path>` (History view)
]);
export type DiffSide = z.infer<typeof DiffSideSchema>;

export const FileDiffSchema = z.object({
  repo: RepoPathSchema,
  path: z.string(),
  origPath: z.string().nullable(),
  side: DiffSideSchema,
  /** Unified patch text as git emitted it. The renderer (D9 — WP-07 spike)
   *  parses this; the sidecar does NOT pre-parse hunks. Rationale: every
   *  candidate library (@git-diff-view/react, diff2html, @codemirror/merge)
   *  ingests unified text, so pre-parsing would be work thrown away. */
  patch: z.string(),
  /** True for `Binary files ... differ` — render a placeholder, not a diff. */
  binary: z.boolean(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
  added: z.number().int().nonnegative().nullable(),
  deleted: z.number().int().nonnegative().nullable(),
  /** True when the patch was cut at `maxBytes`. `patch` still parses (the cut
   *  lands on a line boundary) but is incomplete — the UI must say so. */
  truncated: z.boolean(),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;

export const DEFAULT_DIFF_CONTEXT_LINES = 3;
export const DEFAULT_DIFF_MAX_BYTES = 1_000_000;

// ── 3.9 Ahead/behind vs an arbitrary base ───────────────────────────────────
// `git rev-list --left-right --count <base>...<head>` → "<behind>\t<ahead>".
// This is also the Phase-2 stale-base-hazard primitive.

export const AheadBehindSchema = z.object({
  base: z.string(),
  head: z.string(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  /** `git merge-base <base> <head>`. Null when the histories are unrelated. */
  mergeBase: ShaSchema.nullable(),
});
export type AheadBehind = z.infer<typeof AheadBehindSchema>;

// ── 3.10 Environment probe ──────────────────────────────────────────────────

export const GhProbeSchema = z.object({
  /** `gh` on PATH. */
  present: z.boolean(),
  /** `gh auth status` (NON-json — `--json` always exits 0, so it is useless as
   *  a health check; 02-research-external.md [35]). */
  authenticated: z.boolean(),
  hosts: z.array(z.string()),
  version: z.string().nullable(),
});
export type GhProbe = z.infer<typeof GhProbeSchema>;

// ═════════════════════════════════════════════════════════════════════════════
// 4 · METHOD SURFACE
// ═════════════════════════════════════════════════════════════════════════════
//
// Adding, renaming or removing a member of `RPC_METHODS` breaks G-RPC. See
// §REGISTRATION CHECKLIST at the bottom of this file.

export const RPC_METHODS = [
  // system
  'system.probe',
  // project / repo
  'project.scan',
  'repo.snapshot',
  'repo.aheadBehind',
  'repo.fetch',
  // changes
  'changes.list',
  'changes.diff',
  'changes.stage',
  'changes.unstage',
  // commit
  'commit.create',
  // history
  'history.log',
  'history.commit',
  // branches
  'branch.list',
  'branch.create',
  'branch.checkout',
  // worktrees
  'worktree.list',
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];

// ── 4.1 Per-method arg schemas ──────────────────────────────────────────────

const SystemProbeArgs = z.object({}).strict();

const ProjectScanArgs = z
  .object({
    /** `hostContext.royaltiSuite.activeProject.root` passed through verbatim
     *  (D5 — consume as-is; `shell/src/lib/pkg/host-context.ts:65`). The three
     *  input cases map 1:1 onto G-05:
     *    field absent  → `undefined` → `no-project`
     *    root is null  → `null`      → `no-project-root`
     *    root is a path→ string      → scan
     *  Resolve it PER CALL, never from spawn-time `IKENGA_PROJECT_ROOT` — that
     *  goes stale on project switch (`pkg_mcp.rs:206-212`). */
    root: z.string().nullable().optional(),
    /** Skip the cache and re-read every repo. */
    fresh: z.boolean().optional(),
  })
  .strict();

const RepoSnapshotArgs = z
  .object({
    repo: RepoPathSchema,
    /** Serve from cache if younger than this. Omit for the sidecar default;
     *  0 forces a fresh read. The MCP always passes 0 — it is stateless and
     *  must never hand Chi a cached view the UI has already invalidated. */
    maxAgeMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const RepoAheadBehindArgs = z
  .object({
    repo: RepoPathSchema,
    /** e.g. `main`, `origin/main`. */
    base: RefSchema,
    /** Defaults to `HEAD`. */
    head: RefSchema.optional(),
  })
  .strict();

const RepoFetchArgs = z
  .object({
    repo: RepoPathSchema,
    /** Defaults to the branch's remote, else `origin`. */
    remote: RefSchema.optional(),
    /** `--prune`. Safe tier: removes only remote-tracking refs. */
    prune: z.boolean().optional(),
  })
  .strict();

const ChangesListArgs = z
  .object({
    repo: RepoPathSchema,
    /** Include `!` ignored entries. Default false — `--ignored` is expensive on
     *  a tree with node_modules. */
    includeIgnored: z.boolean().optional(),
    /** Attach numstat (`added`/`deleted`/`binary`). Default true; the rollup
     *  path can turn it off to halve the work. */
    withNumstat: z.boolean().optional(),
  })
  .strict();

const ChangesDiffArgs = z
  .object({
    repo: RepoPathSchema,
    path: PathspecSchema,
    side: DiffSideSchema,
    /** Required iff `side === 'commit'`. */
    sha: ShaSchema.optional(),
    contextLines: z.number().int().min(0).max(100).optional(),
    maxBytes: z.number().int().positive().max(10_000_000).optional(),
  })
  .strict();

const ChangesStageArgs = z
  .object({
    repo: RepoPathSchema,
    /** Explicit paths only. There is no "stage all" in this contract — an
     *  empty array is invalid, and a `.` pathspec is a normal path that the
     *  cross-repo guard still checks. */
    paths: z.array(PathspecSchema).min(1),
  })
  .strict();

const ChangesUnstageArgs = z
  .object({
    repo: RepoPathSchema,
    paths: z.array(PathspecSchema).min(1),
  })
  .strict();

const CommitCreateArgs = z
  .object({
    repo: RepoPathSchema,
    /** Explicit path list — an ASSERTION, not a pathspec (DELTA 7). The commit
     *  itself is always `git commit -F -`, which records the INDEX; this list
     *  is the caller's statement of what it believes is staged, and git-core
     *  refuses with `staged-set-mismatch` (nothing committed) unless the repo's
     *  staged set EQUALS it. That is how `commit.create` stages nothing and
     *  commits nothing implicitly (01-plan.md §MCP threat model) without the
     *  `--only` pathspec form, which would silently commit the WORKING TREE of
     *  these paths instead of their staged content. Empty array = commit what
     *  is already staged (assertion skipped), and is allowed ONLY from the UI —
     *  the MCP tool schema requires a non-empty list. */
    paths: z.array(PathspecSchema),
    message: CommitMessageSchema,
    /** Never set by this pkg. Present so a future Phase-4 "snapshot" mode can
     *  pass `--no-verify` for auto-commits without re-freezing G-RPC. Ignored
     *  in v1; the sidecar refuses `true`. */
    noVerify: z.boolean().optional(),
  })
  .strict();

const HistoryLogArgs = z
  .object({
    repo: RepoPathSchema,
    /** Defaults to `HEAD`. */
    ref: RefSchema.optional(),
    /** GitLens pagination shape: first page 500, subsequent 200
     *  (02-research-external.md [13]). */
    limit: z.number().int().positive().max(2000).optional(),
    /** `--skip` offset. Opaque cursors buy nothing here — the DAG is stable
     *  under the ref for the life of a page view, and a changed ref means the
     *  UI is re-fetching from 0 anyway. */
    skip: z.number().int().nonnegative().optional(),
    /** Restrict to commits touching this path. */
    path: PathspecSchema.optional(),
  })
  .strict();

const HistoryCommitArgs = z
  .object({
    repo: RepoPathSchema,
    sha: ShaSchema,
    /** Include `%G?` signature status. Costs a signature verification per
     *  commit, so off by default; the commit-detail pane turns it on. */
    withSignature: z.boolean().optional(),
  })
  .strict();

const BranchListArgs = z
  .object({
    repo: RepoPathSchema,
    /** Include `refs/remotes/*`. Default false. */
    includeRemote: z.boolean().optional(),
  })
  .strict();

const BranchCreateArgs = z
  .object({
    repo: RepoPathSchema,
    name: BranchNameSchema,
    /** Defaults to `HEAD`. */
    startPoint: RefSchema.optional(),
    /** Create AND switch. When true this inherits `branch.checkout`'s dirty-tree
     *  rules — see `confirm`. */
    checkout: z.boolean().optional(),
    /** Required when `checkout` is true and the tree is dirty (G-12 confirm
     *  tier). */
    confirm: z.boolean().optional(),
  })
  .strict();

const BranchCheckoutArgs = z
  .object({
    repo: RepoPathSchema,
    name: RefSchema,
    /** G-12 confirm tier: a checkout on a dirty tree returns
     *  `confirm-required` until this is true. git's own "would be overwritten"
     *  refusal still applies on top — this gate exists so the UI can explain
     *  BEFORE git errors, not so it can override git. */
    confirm: z.boolean().optional(),
  })
  .strict();

const WorktreeListArgs = z.object({ repo: RepoPathSchema }).strict();

// ── 4.2 Per-method result schemas ───────────────────────────────────────────

const SystemProbeResult = rpcResult({
  /** Sidecar package version. */
  version: z.string(),
  /** `git --version`. Null ⇒ `git-missing` on every other method. */
  gitVersion: z.string().nullable(),
  gh: GhProbeSchema,
  platform: z.enum(['linux', 'darwin', 'win32', 'other']),
  /** Which `@parcel/watcher` backend bound (D10 — cross-platform from P1).
   *  Null when the watcher failed to start; the UI then falls back to polling
   *  and says the repo view may lag. */
  watcherBackend: z.string().nullable(),
});

const ProjectScanResult = rpcResult({ project: ProjectRollupSchema });
const RepoSnapshotResult = rpcResult({ snapshot: RepoSnapshotSchema });
const RepoAheadBehindResult = rpcResult({ counts: AheadBehindSchema });
const RepoFetchResult = rpcResult({
  remote: z.string(),
  /** Refs that actually moved. Empty = already up to date. */
  updated: z.array(z.string()),
  /** Post-fetch snapshot so the caller does not need a second round-trip to
   *  redraw the ahead/behind badge. */
  snapshot: RepoSnapshotSchema,
});

const ChangesListResult = rpcResult({
  repo: RepoPathSchema,
  staged: z.array(FileChangeSchema),
  unstaged: z.array(FileChangeSchema),
  untracked: z.array(FileChangeSchema),
  /** `u` lines. Non-empty ⇒ the commit box is disabled. */
  conflicted: z.array(FileChangeSchema),
  capturedAt: z.number().int(),
});

const ChangesDiffResult = rpcResult({ diff: FileDiffSchema });

/** Stage/unstage share a result: the paths that moved plus a fresh snapshot.
 *  Mutating paths RE-READ status rather than patching a cache — that is the
 *  G-03 mitigation for "two processes disagree about what is staged", which is
 *  the single worst failure mode for a git tool. */
const StageResult = rpcResult({
  repo: RepoPathSchema,
  changed: z.array(z.string()),
  snapshot: RepoSnapshotSchema,
});

const CommitCreateResult = rpcResult({
  repo: RepoPathSchema,
  sha: ShaSchema,
  /** `git commit`'s own summary line, e.g. `[main a1b2c3d] subject`. */
  summary: z.string(),
  /** True when git actually signed (read back from `%G?`), so the UI can prove
   *  verification 4 without the user opening a terminal. Null when unchecked. */
  signed: z.boolean().nullable(),
  snapshot: RepoSnapshotSchema,
});

const HistoryLogResult = rpcResult({
  repo: RepoPathSchema,
  commits: z.array(CommitSummarySchema),
  /** `skip` to pass for the next page, or null at the end of history. */
  nextSkip: z.number().int().nonnegative().nullable(),
});

const HistoryCommitResult = rpcResult({ commit: CommitDetailSchema });

const BranchListResult = rpcResult({
  repo: RepoPathSchema,
  branches: z.array(BranchInfoSchema),
});

const BranchMutateResult = rpcResult({
  repo: RepoPathSchema,
  branch: BranchInfoSchema,
  snapshot: RepoSnapshotSchema,
});

const WorktreeListResult = rpcResult({
  repo: RepoPathSchema,
  worktrees: z.array(WorktreeInfoSchema),
});

// ── 4.3 The registry — ONE place, exhaustiveness-checked ────────────────────

/** G-12 tier. `destructive` exists only to be unrepresentable in v1: no method
 *  carries it, and the `assertNoDestructiveMethods()` check below keeps it that
 *  way until a decision doc says otherwise. */
export type OpTier = 'safe' | 'confirm' | 'destructive';

/** The frozen MCP tool list (gate G-MCP, signed off Round 2). A method's `mcp`
 *  field must be one of these or null — the type makes an unlisted tool name a
 *  compile error. */
export const MCP_TOOLS = [
  'git_status',
  'git_diff',
  'git_log',
  'git_branch_list',
  'git_worktree_list',
  'git_ahead_behind',
  'git_commit',
] as const;
export type McpTool = (typeof MCP_TOOLS)[number];

/** NEVER exposed as an MCP tool in v1 (01-plan.md §MCP threat model). These are
 *  not method names — they are the git operations whose damage survives an
 *  auto-approved Claude Code permission prompt. Listed as data so WP-05 can
 *  assert its own tool list against it in a test, and so the list is reviewable
 *  in one place rather than inferred from absence. */
export const NEVER_EXPOSE_IN_MCP = [
  'push',
  'push --force',
  'reset --hard',
  'clean -fd',
  'checkout -- <path>', // discard: the only common git op with NO reflog recovery
  'branch -D',
  'worktree remove',
  'stash drop',
  'rebase',
  'filter-branch',
  'gh pr merge',
  'gh pr close',
  'gh release create',
] as const;

export interface MethodSpec {
  args: z.ZodTypeAny;
  result: z.ZodTypeAny;
  /** True ⇒ takes the per-repo mutation mutex and retries `index.lock` (G-13). */
  mutating: boolean;
  tier: OpTier;
  /** MCP tool name, or null when the method is UI-only. */
  mcp: McpTool | null;
  /** One line, used by the trust prompt copy and by the WP-05 tool description. */
  summary: string;
}

/**
 * THE registry. `satisfies Record<RpcMethod, MethodSpec>` is load-bearing:
 *   - omit a method from `RPC_METHODS` → its entry here is an excess property
 *   - omit an entry here → missing-property error
 * So the "union and the table drifted apart" bug the studio precedent is prone
 * to (three hand-maintained places) cannot happen. The dispatch switch is the
 * one remaining hand-written place, and `assertNever` in its default branch
 * makes a missing case a compile error too.
 */
export const RpcSpec = {
  'system.probe': {
    args: SystemProbeArgs,
    result: SystemProbeResult,
    mutating: false,
    tier: 'safe',
    mcp: null,
    summary: 'Report git/gh availability, platform and watcher backend.',
  },
  'project.scan': {
    args: ProjectScanArgs,
    result: ProjectScanResult,
    mutating: false,
    tier: 'safe',
    mcp: null,
    summary: 'Discover every repo in a project root, including nested clones.',
  },
  'repo.snapshot': {
    args: RepoSnapshotArgs,
    result: RepoSnapshotResult,
    mutating: false,
    tier: 'safe',
    mcp: 'git_status',
    summary: 'Branch, upstream, ahead/behind, dirty counts, worktrees for one repo.',
  },
  'repo.aheadBehind': {
    args: RepoAheadBehindArgs,
    result: RepoAheadBehindResult,
    mutating: false,
    tier: 'safe',
    mcp: 'git_ahead_behind',
    summary: 'Commit counts between an arbitrary base and head, plus merge-base.',
  },
  'repo.fetch': {
    args: RepoFetchArgs,
    result: RepoFetchResult,
    mutating: false, // touches only remote-tracking refs; never the worktree or index
    tier: 'safe',
    mcp: null,
    summary: 'Update remote-tracking refs. Never touches the working tree.',
  },
  'changes.list': {
    args: ChangesListArgs,
    result: ChangesListResult,
    mutating: false,
    tier: 'safe',
    mcp: null, // `git_status` (repo.snapshot) is the MCP-side status surface
    summary: 'Staged / unstaged / untracked / conflicted file lists for one repo.',
  },
  'changes.diff': {
    args: ChangesDiffArgs,
    result: ChangesDiffResult,
    mutating: false,
    tier: 'safe',
    mcp: 'git_diff',
    summary: 'Unified patch for one file on one side.',
  },
  'changes.stage': {
    args: ChangesStageArgs,
    result: StageResult,
    mutating: true,
    tier: 'safe',
    mcp: null,
    summary: 'Stage explicit paths. Refuses paths owned by another repo.',
  },
  'changes.unstage': {
    args: ChangesUnstageArgs,
    result: StageResult,
    mutating: true,
    tier: 'safe', // mixed reset only — never --hard; the worktree is untouched
    mcp: null,
    summary: 'Unstage explicit paths (mixed reset). Working tree untouched.',
  },
  'commit.create': {
    args: CommitCreateArgs,
    result: CommitCreateResult,
    mutating: true,
    tier: 'safe',
    mcp: 'git_commit',
    summary: 'Commit explicit paths with a message. Stages nothing implicitly.',
  },
  'history.log': {
    args: HistoryLogArgs,
    result: HistoryLogResult,
    mutating: false,
    tier: 'safe',
    mcp: 'git_log',
    summary: 'Paginated commit list with parents, for the graph and the log view.',
  },
  'history.commit': {
    args: HistoryCommitArgs,
    result: HistoryCommitResult,
    mutating: false,
    tier: 'safe',
    mcp: null,
    summary: 'Full detail for one commit: body, trailers, per-file numstat.',
  },
  'branch.list': {
    args: BranchListArgs,
    result: BranchListResult,
    mutating: false,
    tier: 'safe',
    mcp: 'git_branch_list',
    summary: 'Branches with upstream, ahead/behind and worktree occupancy.',
  },
  'branch.create': {
    args: BranchCreateArgs,
    result: BranchMutateResult,
    mutating: true,
    tier: 'safe', // creating a ref is safe; the optional checkout is what confirms
    mcp: null,
    summary: 'Create a branch, optionally switching to it.',
  },
  'branch.checkout': {
    args: BranchCheckoutArgs,
    result: BranchMutateResult,
    mutating: true,
    tier: 'confirm',
    mcp: null,
    summary: 'Switch branches. Requires confirmation when the tree is dirty.',
  },
  'worktree.list': {
    args: WorktreeListArgs,
    result: WorktreeListResult,
    mutating: false,
    tier: 'safe',
    mcp: 'git_worktree_list',
    summary: 'Linked worktrees with lock/prunable state.',
  },
} satisfies Record<RpcMethod, MethodSpec>;

export type ArgsOf<M extends RpcMethod> = z.infer<(typeof RpcSpec)[M]['args']>;
export type ResultOf<M extends RpcMethod> = z.infer<(typeof RpcSpec)[M]['result']>;

/** Handler table shape. WP-04's sidecar and WP-06's UI mock both implement
 *  this, which is exactly the G-RPC DoD ("a sidecar stub AND a UI mock both
 *  compile against it"). */
export type RpcHandlers = {
  [M in RpcMethod]: (args: ArgsOf<M>) => Promise<ResultOf<M>>;
};

/** Client shape — what the UI's transport module exposes. */
export type RpcClient = <M extends RpcMethod>(method: M, args: ArgsOf<M>) => Promise<ResultOf<M>>;

// ── 4.4 Derived views + invariants ──────────────────────────────────────────

export const MUTATING_METHODS: readonly RpcMethod[] = RPC_METHODS.filter(
  (m) => RpcSpec[m].mutating
);

export const MCP_METHOD_BY_TOOL: Readonly<Partial<Record<McpTool, RpcMethod>>> =
  Object.fromEntries(
    RPC_METHODS.filter((m) => RpcSpec[m].mcp !== null).map((m) => [RpcSpec[m].mcp as McpTool, m])
  );

/** WP-05 calls this in a unit test. Fails if the MCP surface has drifted from
 *  the G-MCP freeze: exactly seven tools, exactly one of them mutating. */
export function assertMcpSurface(): void {
  const exposed = RPC_METHODS.map((m) => RpcSpec[m].mcp).filter((t): t is McpTool => t !== null);
  const missing = MCP_TOOLS.filter((t) => !exposed.includes(t));
  if (missing.length > 0) {
    throw new Error(`G-MCP drift: frozen tools not mapped to a method: ${missing.join(', ')}`);
  }
  if (new Set(exposed).size !== exposed.length) {
    throw new Error('G-MCP drift: two methods claim the same MCP tool name');
  }
  const mutatingTools = RPC_METHODS.filter((m) => RpcSpec[m].mcp && RpcSpec[m].mutating);
  if (mutatingTools.length !== 1 || RpcSpec[mutatingTools[0]!].mcp !== 'git_commit') {
    throw new Error(
      `G-MCP drift: expected exactly one mutating MCP tool (git_commit), got ${mutatingTools.join(', ')}`
    );
  }
}

/**
 * COMPILE-TIME proof that no method carries the `destructive` tier (G-12).
 * If someone sets `tier: 'destructive'` on any entry in `RpcSpec`, the union of
 * declared tiers gains that member and this assignment stops compiling.
 * This is the strongest form of "not in v1" available: not a lint, not a test.
 */
type DeclaredTiers = (typeof RpcSpec)[RpcMethod]['tier'];
type NoDestructiveTier = Extract<DeclaredTiers, 'destructive'> extends never ? true : never;
export const NO_DESTRUCTIVE_METHODS: NoDestructiveTier = true;

/** Runtime companion to the type above, for WP-04's boot check and for callers
 *  that reach `RpcSpec` through a widened type. The `as OpTier` widening is
 *  deliberate: without it `tsc` reports the comparison as impossible — which is
 *  itself the proof, but is an error rather than a green build. */
export function assertNoDestructiveMethods(): void {
  const bad = RPC_METHODS.filter((m) => (RpcSpec[m].tier as OpTier) === 'destructive');
  if (bad.length > 0) {
    throw new Error(`G-12 violation: destructive-tier methods present: ${bad.join(', ')}`);
  }
}

/** Exhaustiveness guard for the dispatch switch's default branch. */
export function assertNever(x: never): never {
  throw new Error(`unhandled RPC method: ${String(x)}`);
}

/** Runtime membership test — the JSON-RPC dispatcher's first gate. */
export function isRpcMethod(m: string): m is RpcMethod {
  return (RPC_METHODS as readonly string[]).includes(m);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5 · ENVELOPES — JSON-RPC 2.0
// ═════════════════════════════════════════════════════════════════════════════
//
// Note the two-layer error model, which is deliberate:
//   - JSON-RPC `error` = the call never reached a handler (parse error, unknown
//     method, malformed args). Codes are the standard ones.
//   - `result.ok === false` = the handler ran and the OPERATION failed. This is
//     where every `GitErrorReason` lives.
// A consumer that only handles JSON-RPC `error` will silently treat a
// `not-a-repository` as success. Both must be handled.

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  method: z.string(),
  params: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export interface RpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/** Standard JSON-RPC codes, plus none of our own — operational failures use
 *  `result.ok === false`, never a custom code. */
export const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

// ── 5.1 Notifications — the ONLY push signal ────────────────────────────────
//
// D7 (locked R2) = push. The MCP notification relay is frame-capped
// (`shell/src-tauri/src/pkg/lifecycle.rs:148-166`) and a rebase, a large
// checkout or an agent write-storm will exceed it. So the sidecar coalesces
// IN-SIDECAR — debounce plus a hard max-wait ceiling, because pure debounce
// never fires under a continuous event stream (02-research-external.md [34]) —
// and emits at most ONE `repo.changed` per repo per window. WP-12's forwarder
// carries this and nothing else; per-file events must never cross the relay.
//
// Adding a second notification method re-opens G-RPC. This is the point.

export const NOTIFICATION_METHODS = ['repo.changed'] as const;
export type NotificationMethod = (typeof NOTIFICATION_METHODS)[number];

export const RepoChangedParamsSchema = z.object({
  repo: RepoPathSchema,
  /** Why the sidecar thinks it changed. `mutation` = this pkg did it (the UI
   *  already has a fresh snapshot from the mutation result and can skip the
   *  refetch); `fs` = someone else did (an agent committing in a terminal —
   *  the case this whole feature exists for); `poll` = the watcher is down and
   *  this came from the fallback timer. */
  reason: z.enum(['fs', 'mutation', 'poll']),
  /** Epoch ms of the LAST event in the coalesced window. */
  at: z.number().int(),
  /** Monotonic per-repo counter. A consumer that sees a gap knows the relay
   *  dropped frames and should refetch rather than trust its cache. */
  seq: z.number().int().nonnegative(),
  /** How many raw fs events this notification stands for. >1 proves coalescing
   *  is working; the WP-12 burst test asserts on it. */
  coalesced: z.number().int().positive(),
});
export type RepoChangedParams = z.infer<typeof RepoChangedParamsSchema>;

export const RpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('repo.changed'),
  params: RepoChangedParamsSchema,
});
export type RpcNotification = z.infer<typeof RpcNotificationSchema>;

/** Watcher tuning. `MAX_WAIT` is the ceiling that forces a flush during a
 *  continuous stream; `DEBOUNCE` is the quiet-period. */
export const WATCH_DEBOUNCE_MS = 150;
export const WATCH_MAX_WAIT_MS = 1000;
/** Fallback poll when `watcherBackend` is null. Deliberately slow: this is the
 *  path that would otherwise become the `index.lock` noise source that breaks
 *  the user's own `tsc --watch` (02-research-external.md [32][33]). Every read
 *  in this path runs `--no-optional-locks`. */
export const WATCH_FALLBACK_POLL_MS = 5000;

/** Snapshot cache TTL for the supervised instance. Short on purpose — G-03. */
export const SNAPSHOT_TTL_MS = 2000;

/** G-13: `index.lock` retry budget. Exceeding it returns `index-locked`, which
 *  the UI renders as "another process is writing to this repo — retrying",
 *  never as a raw git error. */
export const INDEX_LOCK_RETRIES = 5;
export const INDEX_LOCK_BACKOFF_MS = [50, 100, 200, 400, 800] as const;

// ═════════════════════════════════════════════════════════════════════════════
// 6 · AppBridge envelope (WP-12, contract minor)
// ═════════════════════════════════════════════════════════════════════════════
//
// WP-12 adds this to `contract/src/app-bridge.ts`. It is drafted here so WP-06
// can subscribe before the contract bump lands, and so the shape is reviewed as
// part of G-RPC rather than invented separately in the shell repo.

export interface HostSidecarEvent<P = unknown> {
  type: 'host-sidecar-event';
  /** Scopes delivery — the shell must only deliver to the OWNING pkg's iframe. */
  pkgId: string;
  /** Manifest sidecar name (`SIDECAR_NAME`). */
  sidecar: string;
  /** The notification method, e.g. `repo.changed`. */
  method: string;
  params: P;
}

export type GitHostSidecarEvent = HostSidecarEvent<RepoChangedParams>;

// ═════════════════════════════════════════════════════════════════════════════
// 7 · REGISTRATION CHECKLIST — read this before adding a method
// ═════════════════════════════════════════════════════════════════════════════
//
// The studio precedent needs three hand-maintained places for a new RPC method
// and `tsc` catches none of the drift (memory: "new sidecar RPC = add
// switch-case + RpcMethod + EXTENDED_METHODS allowlist — tsc can't catch the
// Set"). Here, two of the three are collapsed into `RpcSpec` and the third is
// exhaustiveness-checked. Adding a method is therefore:
//
//   1. `RPC_METHODS`  — add the literal.
//        ⮑ `RpcSpec` immediately fails to compile (missing property).
//   2. `RpcSpec`      — add the entry: args schema, result schema (wrapped in
//                       `rpcResult`), `mutating`, `tier`, `mcp`, `summary`.
//        ⮑ `RpcHandlers` immediately fails to compile in the sidecar AND in
//          the UI mock (missing method).
//   3. sidecar dispatch switch (`sidecar/src/rpc.ts`) — add the `case`.
//        ⮑ the `default: assertNever(method)` branch fails to compile until
//          you do. This is the only hand-written place left.
//
// And the FOUR git-specific gates that `tsc` cannot check for you:
//
//   4. **git-core allowlist.** If the method needs a git subcommand not already
//      on the hardcoded allowlist (`status`, `diff`, `log`, `add`, `reset`
//      (mixed), `commit`, `branch`, `checkout`, `worktree list`, `rev-list`,
//      `rev-parse`, `merge-base`, `stash create`, `fetch`), you are widening
//      the containment boundary (G-02). That is a plan change, not a WP change.
//   5. **G-MCP.** Setting `mcp` to a non-null value puts the method on a surface
//      that ANY `claude` session on the machine can call, with Claude Code's
//      own permission prompt as the ONLY confirmation layer. The list is frozen
//      and user-signed-off; `assertMcpSurface()` fails if it drifts.
//   6. **G-12 tier.** `mutating: true` means the method takes the per-repo
//      mutex and retries `index.lock`. `tier: 'confirm'` means the handler must
//      return `confirm-required` before doing anything, not after.
//   7. **Notifications.** `NOTIFICATION_METHODS` has exactly one member by
//      design. A second one re-opens G-RPC and the relay-saturation risk.
//
// ─────────────────────────────────────────────────────────────────────────────
// OPEN QUESTIONS raised by this draft — for the orchestrator, not for WP-03/04:
//
//   Q1. `repo.init` (DELTA 4): G-05 state (c) offers `git init`, but `init` is
//       not on the git-core allowlist and no method here provides it. Either
//       widen the allowlist by one subcommand, or make the empty state offer a
//       copyable command. Currently: the latter.
//   Q2. One-shot vs supervised (§0): every UI call spawns a fresh process, so
//       the cache the plan attributes to "the sidecar" lives only in the
//       supervised instance. WP-04 must decide whether the one-shot path reads
//       git directly (simple, no cache benefit for the UI) or talks to the
//       supervised instance over a local channel (fast, more moving parts).
//       `capturedAt`/`stale` on `RepoSnapshot` keep both honest either way.
//   Q3. `commit.create` with `paths: []` means "commit what is staged" from the
//       UI but is forbidden from the MCP. That asymmetry lives in WP-05's tool
//       schema, not here — flagged so it is not lost.
