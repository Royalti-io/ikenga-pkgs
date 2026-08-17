---
'@ikenga/skill-thunderbird': patch
---

Drop the `fs.read` and `shell.execute` declarations (ADR-020).

Thunderbird is skill-only — no `mcp` block, no `sidecars` — so neither scope has
a consumer: `shell.execute` gates the sidecar spawn that never happens, and
`fs.read` becomes a live Tauri ACL grant that, with no `remove_capability` in
Tauri 2.11, outlives the pkg until process exit. The mail-store reads are done
by Claude Code under its own permission model, not through the kernel's ACL.

`net` and `vault.keys` are kept: those scopes are not wired to any enforcement
point and exist to record intent, which is how eleven sibling skills already use
`sqlite.tables`.

Strictly reduces granted scope; no behaviour change to the skill.
