---
"@ikenga/skill-tasks": minor
---

Initial release of `@ikenga/skill-tasks` (WP-16 — scaffold + dispatch actions).

Introduces the tasks dispatch skill: roster setup and completion-sweep for the
tasks domain. **Dispatch-only per R4** — task CRUD belongs to the tasks app
pkg (`com.ikenga.tasks`), not here.

Two actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` lifecycle
  action; infers project roster (humans + agents) from repo context; confirms
  in chat (D-02); writes `${CLAUDE_PROJECT_DIR}/.atelier/skill-tasks/roster.json`
  (WP-10 Roster-config contract) + `manifest.json` with sweep tuning params.
  Closes the WP-10 loop: the roster.json file is consumed by the shell at
  iframe-mount time and injected into the Tasks pkg hostContext as
  `hostContext.royaltiSuite.tasksRoster`, populating the owner-picker and
  reassign dropdown in `com.ikenga.tasks`.

- `sweep` (`ux_mode: approve`) — reads completion-signal candidates from
  `ikenga.db` (`tasks` + `agent_runs` + `delegations`) via `host.dbQuery`
  (SELECT-only); produces a draft close-decision list with confidence levels and
  evidence; pauses for the operator approve/edit/reject gate (E-11) before any
  write. Absorbed `pa:task-health` cron as a `30 */4 * * *` schedule trigger.
  Approved closes dispatch through the host write path — the skill itself never
  writes to the DB.

Both actions declare `depends_on: ["skill-core"]`, carry zero CRUD verbs
(dispatch-only, R4), keep state on the local `ikenga.db` (no Supabase, no
`supabase_tables` field), and validate against the locked `ActionFrontmatter`
Zod (WP-06).

Manifest: `id: "com.ikenga.skill-tasks"`, `kind: "skill"`,
`capabilities.sqlite.db: "ikenga.local"`,
`permissions["sqlite.tables"]: ["tasks", "agent_runs", "delegations"]`
(narrowed to what `sweep` actually queries), `requires: [{kind:"skill",
name:"skill-core"}]` — no `skills` field.
