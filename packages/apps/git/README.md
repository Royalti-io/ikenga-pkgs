# com.ikenga.git

Git mini-app pkg (Bun sidecar + MCP + UI) that tracks every Ikenga project's
repo(s), reuses the user's existing git/gh auth by shelling out rather than
storing credentials, and makes agent worktrees, attribution and stale-base
hazards first-class.

Plan: `plans/git/01-plan.md` (workspace root, gitignored from this repo).

## Status — WP-02 scaffold

This is the Phase-1 scaffold: a manifest with all three runtime blocks
(`sidecars[]`, `mcp[]`, `ui`) and stub processes that boot cleanly under the
kernel supervisor. None of the git logic is implemented yet:

| Block | State | Lands in |
|---|---|---|
| `sidecar/` | stdio JSON-RPC loop stub — returns `{ok:false, reason:"not_implemented"}` for every method | WP-04 (discovery · watch · cache · RPC · guard) |
| `mcp/` | MCP server stub — one `ping` tool | WP-05 (read-first tool surface, frozen by G-MCP) |
| `ui/` | static placeholder pane, no bridge calls | WP-06/07/08/09 (side-menu views) |
| `core/` (not yet present) | — | WP-03 (`git-core`: discovery, argv construction, env denylist, parsers) |

## Architecture

```
UI iframe   (side-menu views via host.pkg.setMenu: Changes · History · Branches · Worktrees · PRs)
   │ host.pkgSidecarCall (one-shot RPC) + AppBridge push of coalesced sidecar events
Bun sidecar (kernel-supervised, manifest.sidecars[])  ── fs-watch + cache + UI-facing RPC
MCP server  (manifest.mcp[]; ALSO registered into ~/.claude.json → runs OUTSIDE the shell)  ── stateless per call
   └──────────── both consume ──────────────┐
git-core (TS lib: discovery, argv construction, env denylist, porcelain-v2 / worktree / log parsers)
   └── spawns `git` / `gh` (user's binaries, user's env minus IKENGA_*, GIT_TERMINAL_PROMPT=0)
```

Git on disk is the single owner of repo state — every in-process model here
is a cache over it. See `01-plan.md` §Architecture, §Command construction
rules (G-02), §MCP threat model (G-04), §Destructive operation tiers (G-12).

## Permissions

- `shell.execute: ["node", "bun", "git", "gh"]` — `node`/`bun` are the
  kernel-enforced launcher entries (`check_shell_execute`); `git`/`gh` are
  disclosure-only for the trust prompt (the manifest allowlist is not a
  sandbox once the sidecar is running — see `01-plan.md` §Command
  construction rules for the real containment boundary).
- `fs.read` / `fs.write`: `$home/**` — declared honestly (D8). Neither scope
  has a runtime enforcement site today; this is disclosure, not an ACL grant.
  A narrower `$project_root` token is deferred until `fs.*` gains enforcement.

## Develop

```bash
pnpm install   # from the ikenga-pkgs workspace root
npm run build:sidecar
npm run build:mcp
npm run build:ui                # required before the pane will mount
ikenga dev packages/apps/git    # mount into the running shell
```

The supervisor watches `sidecar/dist/sidecar.js` and `mcp/dist/index.js`
(per `restart_when_changed`) and respawns each on rebuild.

### Three `dist/` directories, one of them load-bearing

| Path | Built by | Consumed by |
|---|---|---|
| `dist/` (pkg root) | `npm run build:ui` (vite, `outDir: '../dist'`) | the shell's iframe content server |
| `sidecar/dist/sidecar.js` | `npm run build:sidecar` | `manifest.sidecars[0].bin` |
| `mcp/dist/index.js` | `npm run build:mcp` | `manifest.mcp[0].args` |

The UI bundle **must** sit at the pkg root's `dist/`. The shell hardcodes an
iframe pkg's content root to `<pkg>/dist` (`pkg_content/mod.rs:493`,
`server/pkg_static.rs:211`) and `mint_html` strips only a leading `dist/` from
the manifest `source` before joining it to that root; `UiBlock` has no
`dist_root` field to point elsewhere. A bundle under `ui/dist/` is
unreachable — the pane renders an error page rather than the app.

## Build for publish

```bash
npm run build
```

See [`docs/pkg-patterns/03-mcp-server.md`](../../../../docs/pkg-patterns/03-mcp-server.md)
and [`docs/pkg-patterns/05-sidecar.md`](../../../../docs/pkg-patterns/05-sidecar.md).
