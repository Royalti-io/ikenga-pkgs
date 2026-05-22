# @ikenga/pkg-suite

## 0.2.0

### Minor Changes

- [`bdc6c47`](https://github.com/Royalti-io/ikenga-pkgs/commit/bdc6c47cfd1a2104ed67f3950a4ce2477b6200a6) Thanks [@nedjamez](https://github.com/nedjamez)! - Initial release of `@ikenga/pkg-suite` — business suite (Tasks, Sales, Outbound, Email) over Supabase. Mounts at `/pkg/com.ikenga.suite/` with a single shell-nav entry under the `ops` section; internal sidebar routes to each feature via `location.hash`. Multi-file ES-module pkg, no build step — React 19 + htm + `@modelcontextprotocol/ext-apps` SDK + supabase-js loaded from esm.sh. CSP overrides declared in `ui.csp` to permit esm.sh and `*.supabase.co`. Tasks kanban is wired against `tasks`/`task_comments`; Sales/Outbound/Email ship as placeholder components ready to be filled in. In-pkg Settings page toggles features per-install (localStorage). Forkers can copy the directory, edit `src/features/`, and `ikenga add` without any toolchain install.
