# Suite

Ikenga pkg — business suite (Tasks, Sales, Outbound, Email) over Supabase.
Multi-file iframe pkg, **no build step**. React 19 + htm via esm.sh.

| | |
|---|---|
| Pkg id | `com.ikenga.suite` |
| Kind | `embedded` (UI iframe) |
| Surface | `/pkg/com.ikenga.suite/` |
| Data | Supabase tables (declared in `manifest.json`) |
| Build | none — `src/` is the whole app |

## Layout

```
suite/
├── manifest.json             # CSP allows esm.sh + *.supabase.co
├── package.json
├── README.md
└── dist/                     # kernel convention — iframe sources live here
    ├── index.html            # mount point; imports src/app.js as ES module
    └── src/
        ├── app.js            # bridge + supabase + hash router + sidebar
        ├── lib/
        │   ├── ui.js         # React, ReactDOM, htm (loaded from esm.sh)
        │   ├── bridge.js     # @modelcontextprotocol/ext-apps wrapper
        │   ├── supabase.js   # lazy createClient
        │   └── settings.js   # in-pkg feature toggles (localStorage)
        └── features/
            ├── _registry.js  # imports + exports each feature
            ├── tasks/        # kanban — fully wired
            ├── sales/        # placeholder
            ├── outbound/     # placeholder
            └── email/        # placeholder
```

> **Why `dist/`?** The shell's pkg-content server only serves files under
> `<install_path>/dist/` for iframe routes (kernel convention). For a
> no-build pkg, your "build output" *is* your source — keep editing in
> `dist/src/` directly. Forks work the same way.

## Fork in one step

```bash
cp -r ikenga-pkgs/packages/apps/suite ~/my-suite
# edit ~/my-suite/manifest.json (change id), and any src/features/*
ikenga add ~/my-suite
```

The agent in your Ikenga can do this for you — just ask. No `pnpm install`,
no `tsc`, no Vite. Forks are file edits + reload.

## Disable a feature

Three options, smallest to largest:

1. **Toggle off** in Settings. Hides the sidebar entry; code stays on disk.
2. **Remove from registry.** Delete the feature's `import` + entry in
   `src/features/_registry.js`.
3. **Delete the directory.** `rm -rf src/features/sales/` + step 2 above.

## Disable the whole pkg

```bash
ikenga disable com.ikenga.suite   # nav entry gone next reload
ikenga remove com.ikenga.suite    # uninstall fully
```

## Standalone preview

```
file:///path/to/index.html?url=https://xxx.supabase.co&anon_key=eyJ...
```

The pkg detects `window.parent === window` and falls back to query-string
Supabase config. Useful for quick UI iteration without the shell.

## Required schema (starter)

```sql
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null check (status in ('open','in_progress','blocked','done','cancelled')),
  created_at timestamptz not null default now()
);
create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
-- deals, outbound_messages, email_drafts — design as you wire each feature
```

RLS is the real enforcer; `permissions.supabase.tables` in the manifest is
advisory.

## How it works (bridge protocol)

`src/lib/bridge.js` wraps the canonical MCP Apps SDK
([`@modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps)):

1. `new App({ name, version })`
2. Register `onhostcontextchanged` / `onerror` / `onteardown` handlers
3. `await app.connect()` — runs the `ui/initialize` handshake automatically
4. `app.getHostContext()` returns `{ theme, styles, supabase, royaltiAuth, … }`
5. Cross-pkg navigation: `app.callServerTool({ name: 'host.navigate', arguments: { path } })`

The shell's `dispatchHostCall` (in `shell/src/components/pkg/pkg-iframe-host.tsx`)
intercepts `host.*` tool names before forwarding to MCP servers.

## CSP

The manifest declares `ui.csp` overrides allowing:

- `script-src` / `style-src` / `font-src`: `https://esm.sh` (CDN for React, htm, Supabase, ext-apps SDK)
- `connect-src`: `https://*.supabase.co` (PostgREST) + `wss://*.supabase.co` (Realtime)

To use a different CDN or self-host these modules, edit `manifest.json` and
the import URLs in `src/lib/ui.js`, `src/lib/bridge.js`, `src/lib/supabase.js`.

See [`docs/pkg-patterns/01-ui-iframe.md`](../../../../docs/pkg-patterns/01-ui-iframe.md).
