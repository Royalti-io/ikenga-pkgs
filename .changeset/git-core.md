---
'@ikenga/pkg-git': minor
---

WP-03 — `git-core`, the shared library behind `com.ikenga.git`: repo
discovery, argv construction, the child-env denylist, and the porcelain
parsers. Pure TypeScript, no process of its own; the one-shot sidecar, the
long-lived MCP and the tests all import it and `bun build` inlines it into
each bundle. Git on disk stays the single owner of repo state (G-03).

`core/src/rpc.ts` is a byte-verbatim copy of the frozen G-RPC artefact
(`plans/git/drafts/rpc.ts`) — the contract is edited in the plan folder and
re-copied, never edited here.

`core/src/argv.ts` is the real containment boundary (G-02), since the manifest
allowlist only fires at kernel spawn: a hardcoded subcommand allowlist with
per-subcommand verb pinning (`worktree list`, `stash create`), structured
builders that emit `string[]` and take no caller-supplied flags, `--` before
every pathspec, `^-` / NUL / absolute / `..` rejection, and a forbidden-flag
rescan of every finished argv. `--no-optional-locks` and `--literal-pathspecs`
ride on every invocation; commit messages go on stdin via `-F -` so no message
ever reaches argv; `commit` records the INDEX (`git commit -F -`, no
pathspec — a pathspec would commit the working tree instead) and the explicit
path list is enforced as an assertion in `core/src/staged.ts`.

`core/src/env.ts` builds each child env clear-first — `IKENGA_*` and git's
repo-targeting/config-injection variables dropped, `GIT_TERMINAL_PROMPT=0`
forced, and `SSH_AUTH_SOCK` / `GIT_ASKPASS` / credential helpers / signing
config untouched, so the user's own auth and signature work with zero
credential code in the pkg.

`core/src/discover.ts` maps the host context's project root onto the four G-05
no-root states, walks a bounded nested-repo scan (`.git` files as well as
directories, dot-directories walked, `node_modules` skipped, breadth-first so
truncation cuts the deepest repos), and provides the deepest-owner primitive
behind the G-11 cross-repo staging guard.

138 tests, including verification 5 (env asymmetry proved by spawning a real
child and reading its environment back) and verification 6 (option injection),
plus an end-to-end pass against a real `git` binary that skips itself when git
is absent.
