---
"@ikenga/pkg-finance": patch
"@ikenga/pkg-sales": patch
"@ikenga/pkg-outbound": patch
"@ikenga/pkg-content": patch
"@ikenga/pkg-tasks": patch
---

Wire `requires: [{ kind: "skill", name: "skill-<domain>" }]` into the finance / sales / outbound / content / tasks pane manifests so each pane's in-shell action bar surfaces its domain skill's actions via `list_skill_actions` → the Ọba store. Extends WP-25's mail-only proof to all six domain panes.
