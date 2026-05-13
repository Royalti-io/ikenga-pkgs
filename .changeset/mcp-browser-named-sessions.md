---
'@ikenga/mcp-browser': minor
---

Phase 4 — named sessions. Add `browser_session_create / list / delete`
tools so agents can keep multiple workflows isolated under human-friendly
names instead of raw partition slugs. `browser_open` now accepts a
`session` field as an alternative to `partition` — the MCP resolves the
name to a partition on the shell side and bumps `last_used_at` for the
list-by-recent ordering. Deleting a session preserves the on-disk
cookie partition data; re-creating with the same partition slug picks
the cookies back up.

Backed by a new SQLite table `browser_sessions` in the shell (migration
`0014_browser_sessions.sql`).
