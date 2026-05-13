---
'@ikenga/mcp-browser': minor
---

Add `@ikenga/mcp-browser` — MCP server that lets agents drive native
child webviews in the running Ikenga desktop app. 16 tools: open / close /
list / focus / goto / back / forward / reload / snapshot / read_text /
screenshot (stub) / click / fill / select / press_key / wait_for / eval.
Wraps the shell's `/iyke/browser/*` bridge (Phase 3a) and uses the
in-page a11y-snapshot helper for stable `e0..eN` refs. Trust boundary is
the same `control.json` the Iyke MCP and CLI use; per-request oneshot
tokens isolate reply traffic from the global bearer so partner-site JS
can't impersonate snapshots.
