# `git-core`

The shared library behind `com.ikenga.git`. Not a package, not a process — a
directory of pure TypeScript that the sidecar (`../sidecar`), the MCP server
(`../mcp`) and the tests all import, and that `bun build` inlines into each
one's bundle.

> **Git on disk is the single owner of repo state. Every in-process model is a
> cache over it.** (`plans/git/01-plan.md` G-03)

That is why this is a library. The pkg runs a one-shot sidecar (a fresh process
per `host.pkgSidecarCall`) and a long-lived supervised MCP that also owns the
fs-watcher — and the MCP is registered into `~/.claude.json`, so any `claude`
session on the machine can launch a third copy. Three callers, one set of
rules. A *process* would have had to become a fourth participant in a
consistency problem git already solves.

## Layout

| File | Role |
|---|---|
| `src/rpc.ts` | **The frozen contract (G-RPC).** A byte-verbatim copy of `plans/git/drafts/rpc.ts`. |
| `src/argv.ts` | **The containment boundary (G-02).** Subcommand allowlist, structured builders, `--` before every pathspec, `^-` rejection, forbidden-flag rescan. |
| `src/env.ts` | **G-16.** Clear-first child env: `IKENGA_*` stripped, `GIT_TERMINAL_PROMPT=0` forced, credential/signing env untouched. |
| `src/exec.ts` | The single spawn primitive. `shell: false`, a deadline, `buildChildEnv()` — always. |
| `src/discover.ts` | **G-11 / G-05.** Root resolution onto the four no-root states, the bounded nested-repo scan, the cross-repo ownership primitive. |
| `src/errors.ts` | Construction + classification for the frozen error vocabulary, plus credential redaction. |
| `src/parse/*.ts` | Pure porcelain parsers: `status -z`, `worktree list -z`, `log` NUL format, `diff --numstat -z`, `rev-list --left-right --count`, `branch --format`. |

## The two rules that matter most

**1 · `src/rpc.ts` is not edited here.** It is the G-RPC freeze-gate artefact.
Changing a method name, an arg shape, a result shape, an error reason or the
notification surface is a cross-WP re-sync. Edit
`plans/git/drafts/rpc.ts`, re-copy, and record it in `04-discussion.md`.

```bash
diff plans/git/drafts/rpc.ts packages/apps/git/core/src/rpc.ts   # must be empty
```

**2 · Nothing throws for an expected condition.** "No project", "no project
root", "not a repository", "unreadable", "another process holds the index
lock", "gh is not installed" are all *values* — named members of
`GitErrorReason` — because each one is a UI state someone has to render.
Exceptions are reserved for programmer error.

## Widening the boundary is a plan change

`ALLOWED_SUBCOMMANDS` is deliberately short, and adding to it is not a WP
decision (`rpc.ts` §REGISTRATION CHECKLIST item 4). Absences that will tempt
you:

- **`init`** — G-05 state (c) offers `git init` as *copyable text*, not an RPC.
- **`show`** — a commit's patch comes from `log -1 --patch`, which also handles
  root commits correctly.
- **`check-ignore`** — `NestedRepo.ignoredByParent` uses a pathspec-scoped
  `status --ignored` instead. One boolean does not justify moving the boundary.
- **`push`, `clean`, `rebase`, `filter-branch`, `config`, `remote`** — out of
  v1 entirely (§Destructive operation tiers).

## Tests

```bash
cd packages/apps/git && npm test        # node --test via tsx
cd packages/apps/git && npm run typecheck
```

Two of them exist because the plan names them:

- `src/env.test.ts` — **verification 5**, the G-16 env asymmetry, *by
  execution*: a real child is spawned through the real spawn path and its
  environment read back. A test that only inspected `buildChildEnv()`'s return
  value would prove the builder right and say nothing about whether the spawn
  path uses it — and the spawn path is where this leak actually happened
  before, in the cron daemon.
- `src/argv.test.ts` — **verification 6**, option injection: `--upload-pack=…`
  as a pathspec and `-x` as a ref, rejected as `unsafe-argument` and not
  flattened into `invalid-args`.

`src/integration.test.ts` drives a real `git` against a temp repo and skips
itself when git is absent. Everything else runs with no git and no shell.
