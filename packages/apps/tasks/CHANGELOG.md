# @ikenga/pkg-tasks

## 0.4.0

### Minor Changes

- [`7ba2d0f`](https://github.com/Royalti-io/ikenga-pkgs/commit/7ba2d0f44303c82db92c730e41c5d669d07e8602) Thanks [@nedjamez](https://github.com/nedjamez)! - Add a real Create form and wire up Reassign in the Tasks pkg, both writing to
  the local pa.db via `host.dbExec`.

  - **Create**: a new inline form (title / owner / priority / due + optional
    description) does a parameterized `INSERT INTO tasks` (client uuid, ISO
    stamps, status `pending`). The old agent-dispatch path is kept as a secondary
    "Send to your Chi" action alongside the direct create.
  - **Reassign**: the previously dead Reassign button now opens an assignee picker
    that `UPDATE`s `assigned_to` / `assignee_type` (and bumps `updated_at`).
  - New `lib/assignees.js` centralises the assignee roster (`CURRENT_USER` +
    `AGENT_ROSTER`) shared by the create owner field and the reassign picker — the
    seam the accompanying skill's setup step will configure per project.

  No manifest change: both writes target only `tasks`, already declared in
  `permissions["sqlite.tables"]`.

- [`5f4a605`](https://github.com/Royalti-io/ikenga-pkgs/commit/5f4a605ec7ab9e2e2c2b678ee219890a21124608) Thanks [@nedjamez](https://github.com/nedjamez)! - Remove the supabase-js dependency from the Tasks pkg. The status-update write
  now goes through the host's `host.dbExec` verb (local pa.db) like the reads
  already do via `host.dbQuery`, so the pkg no longer declares the `supabase`
  capability, `supabase.tables` permission, or supabase network/CSP access.
