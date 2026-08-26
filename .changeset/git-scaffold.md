---
'@ikenga/pkg-git': minor
---

WP-02 scaffold for `com.ikenga.git`: `manifest.json` with `sidecars[]` (repo
watch/cache/RPC stub), `mcp[]` (read-first git tool surface stub), and `ui`
(side-menu nav skeleton — Changes · History · Branches · Worktrees · PRs)
blocks.

`shell.execute: ["node", "bun", "git", "gh"]` — `node`/`bun` are the
kernel-enforced launcher entries, `git`/`gh` are disclosure-only for the
trust prompt (the real containment boundary is `git-core`'s command
construction rules, landing in WP-03). `fs.read`/`fs.write` declared
`$home/**` per D8 — honest disclosure; neither scope has a runtime
enforcement site today, and a narrower `$project_root` token is deferred
until one exists. `restart_when_changed` globs on both long-lived processes.

The sidecar and MCP server are stdio stubs that boot and respond to every
call without crashing (`{ok:false, reason:"not_implemented"}` / a `ping`
tool respectively) — the real repo discovery, RPC dispatch, and frozen
G-MCP tool surface land in WP-03 through WP-06.
