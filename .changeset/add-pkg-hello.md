---
'@ikenga/pkg-hello': minor
---

Add `@ikenga/pkg-hello` — a manifest-only pkg used to prove the registry
install pipeline end-to-end. No UI, no sidecars, no MCP — installing it
exercises every step from index fetch through kernel registration, and
the registries all no-op cleanly because the manifest declares nothing.
