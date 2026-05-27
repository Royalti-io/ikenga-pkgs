# Tasks

Ikenga pkg — the Tasks workspace: **List**, **Agenda** (today's time-rail), and
**Triage** (backlog health) over the production `tasks` schema. Multi-file
iframe pkg, **no build step**. React 19 + htm + TanStack Query via esm.sh.

| | |
|---|---|
| Pkg id | `com.ikenga.tasks` |
| Kind | `embedded` (UI iframe) |
| Surface | `/pkg/com.ikenga.tasks/` |
| Data | Supabase `tasks` (+ `task_comments`, reserved) |
| Build | none — `dist/` is the whole app |
| License | Apache-2.0 (per ADR-009) |

## Layout

```
tasks/
├── manifest.json             # CSP allows esm.sh + *.supabase.co; tables: tasks, task_comments
├── package.json
├── README.md
├── tsconfig.dev.json         # dev-only checkJs — NEVER in the publish path
└── dist/                     # kernel convention — iframe sources live here
    ├── index.html            # mount point; imports app.js as ES module
    ├── app.js                # bridge + supabase + QueryClient → mounts <TasksView/>
    ├── tasks.css             # locked D-01 visuals (.tk-*/.ag-*/.tr-*/.ip-tab) + de-Tailwind utils
    ├── lib/
    │   ├── ui.js             # React, ReactDOM, htm, TanStack Query (esm.sh) + Icon/Button/cn
    │   ├── bridge.js         # @modelcontextprotocol/ext-apps wrapper
    │   ├── supabase.js       # lazy createClient
    │   ├── queries.js        # Task typedef, list columns, triage/detail/subtask/blocking queries
    │   ├── query-keys.js     # TanStack cache keys
    │   ├── shared.js         # groupTasks / buildAgenda / buildTriage + label helpers
    │   └── esm-sh.d.ts       # dev-only ambient decls for the esm.sh URL imports
    └── features/tasks/
        ├── tasks-view.js     # list + filter bar + groups + master/detail split + view switcher
        ├── task-row.js · task-detail-pane.js
        ├── view-tabs.js · agenda-view.js · triage-view.js
```

> **Why `dist/`?** The shell's pkg-content server only serves files under
> `<install_path>/dist/` for iframe routes (kernel convention). For a
> no-build pkg, your "build output" *is* your source — keep editing in
> `dist/` directly. Forks work the same way.

## Views

- **Tasks** — grouped list (Overdue / Today / This week / Later / Auto-closed)
  with a filter bar (search, status, owner, category, show-auto-closed),
  collapsible group heads, and a master/detail split. The detail pane shows
  status, progress, tags, source chips, subtasks, the blocking task, and an
  activity timeline. Status changes write direct via Supabase (anon RLS grants
  UPDATE of `status`/`completed_at`).
- **Agenda** — projects the loaded list onto today's hourly rail with a live
  now-line and an overdue-pulled-forward bucket.
- **Triage** — four server-side health counts (overdue / stale>7d / unassigned
  / blocked) + sample rows + a backlog health grade.

View selection persists to `localStorage` (`ikenga-tasks-view`).

## Create = dispatch, not insert

Anon RLS only grants `UPDATE` of `status`/`completed_at` on `tasks` — never
`INSERT`. So **New task** does not write to Supabase directly. It dispatches a
user turn into the shell's active Claude session
(`host.sendToActiveSession`); the agent creates the task on its privileged
path. The button is disabled in standalone preview (no host to dispatch to).

## Fork in one step

```bash
cp -r ikenga-pkgs/packages/apps/tasks ~/my-tasks
# edit ~/my-tasks/manifest.json (change id), and any dist/features/*
ikenga add ~/my-tasks
```

No `pnpm install`, no `tsc`, no Vite. Forks are file edits + reload. (The
`tsconfig.dev.json` + `tsc -p tsconfig.dev.json` flow is optional dev-time
type-checking only — it is never part of publish.)

## Standalone preview

```
file:///path/to/dist/index.html?url=https://xxx.supabase.co&anon_key=eyJ...
```

The pkg detects `window.parent === window` and falls back to query-string
Supabase config. Useful for quick UI iteration without the shell.

## CSP

`manifest.json` declares `ui.csp` overrides allowing:

- `script-src` / `style-src` / `font-src`: `https://esm.sh` (React, htm,
  TanStack Query, Supabase, ext-apps SDK)
- `connect-src`: `https://*.supabase.co` (PostgREST) + `wss://*.supabase.co`
  (Realtime)

See [`docs/pkg-patterns/01-ui-iframe.md`](../../../../docs/pkg-patterns/01-ui-iframe.md).
