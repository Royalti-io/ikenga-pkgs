---
"@ikenga/pkg-content": patch
"@ikenga/pkg-research": patch
"@ikenga/pkg-sales": patch
"@ikenga/pkg-tasks": patch
"@ikenga/pkg-mail": patch
"@ikenga/pkg-outbound": patch
"@ikenga/pkg-finance": patch
"@ikenga/pkg-strategy": patch
"@ikenga/pkg-agent-ops": patch
---

Declare permissions.engine ["invoke"] in every app manifest (host.sendToActiveSession
was scope-denied for all pkgs — the field was previously undeclarable). Content gains a
real dispatch wire (handleAction → sendToActiveSession, lib/dispatch.js); research gains
working sidebar facet filters (lib/facet-filter.js); sales gains dispatch-seeded create
buttons (lib/create-dispatch.js) and a bridge source-id fix.
