---
"@ikenga/pkg-suite": minor
---

Initial release of `@ikenga/pkg-suite` — business suite (Tasks, Sales, Outbound, Email) over Supabase. Mounts at `/pkg/com.ikenga.suite/` with a single shell-nav entry under the `ops` section; internal sidebar routes to each feature via `location.hash`. Multi-file ES-module pkg, no build step — React 19 + htm + `@modelcontextprotocol/ext-apps` SDK + supabase-js loaded from esm.sh. CSP overrides declared in `ui.csp` to permit esm.sh and `*.supabase.co`. Tasks kanban is wired against `tasks`/`task_comments`; Sales/Outbound/Email ship as placeholder components ready to be filled in. In-pkg Settings page toggles features per-install (localStorage). Forkers can copy the directory, edit `src/features/`, and `ikenga add` without any toolchain install.
