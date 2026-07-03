---
"@ikenga/pkg-tasks": patch
"@ikenga/pkg-mail": patch
"@ikenga/pkg-sales": patch
"@ikenga/pkg-outbound": patch
"@ikenga/pkg-content": patch
"@ikenga/pkg-research": patch
"@ikenga/pkg-strategy": patch
"@ikenga/pkg-finance": patch
"@ikenga/pkg-agent-ops": patch
---

Runtime extraction: dist/lib bridge/ui/recipe-helper copies are now vendored at
build from packages/lib/pkg-runtime (single source, per-pkg id injected via a
generated pkg-id.js; outbound/agent-ops extras appended as fragments). No runtime
behavior change intended; kills the hand-maintained 9-copy drift and the
copy-paste source-id bug class.
