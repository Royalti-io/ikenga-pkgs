---
"@ikenga/pkg-tasks": minor
---

Add a real Create form and wire up Reassign in the Tasks pkg, both writing to
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
