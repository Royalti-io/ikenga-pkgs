# @ikenga/pkg-git

## 0.1.0

### Minor Changes

- WP-02 scaffold: `manifest.json` with `sidecars[]` (repo watch/cache/RPC stub),
  `mcp[]` (read-first tool surface stub), and `ui` (side-menu nav skeleton)
  blocks; `shell.execute: ["node", "bun", "git", "gh"]`; `fs.read`/`fs.write`
  declared `$home/**` per D8 (honest disclosure — no `$project_root` token
  enforcement exists yet); `restart_when_changed` globs on both long-lived
  processes. Sidecar and MCP are stdio stubs that boot and respond without
  crashing — the real repo discovery / RPC dispatch / tool surface land in
  WP-03 through WP-06.
