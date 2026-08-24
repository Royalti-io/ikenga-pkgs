# @ikenga/skill-tasks

Tasks dispatch skill for Ikenga — roster setup and completion-sweep for the
tasks domain. **Dispatch-only** (R4): task CRUD belongs to the tasks app pkg
(`com.ikenga.tasks`), not here.

## Install

> **Not separately installable.** This skill reads workspace data through
> `host.dbQuery` against `ikenga.db`, so it needs a running Ikenga shell — it
> ships with the shell rather than through the skill marketplace.

## What it does

| Action | Mode | Description |
|---|---|---|
| `setup` | streaming | Configure the project roster (humans + agents); writes `.atelier/skill-tasks/roster.json` + `manifest.json` |
| `sweep` | approve | Read completion-signal candidates from `ikenga.db`; produce draft close-decisions for operator approval |

All state reads go through `host.dbQuery` (SELECT-only) against the local
`ikenga.db`. No writes — approved close-decisions are dispatched through the
host write path, never within the skill.

### Roster integration

`setup` closes the WP-10 loop: it writes
`${CLAUDE_PROJECT_DIR}/.atelier/skill-tasks/roster.json` whose shape is:

```json
{
  "humans": [{ "value": "alice@acme.com", "label": "Alice" }],
  "agents": [{ "id": "finance-agent", "label": "Finance" }]
}
```

The shell reads this file at iframe-mount time and injects it into the Tasks
pkg's `hostContext` as `hostContext.royaltiSuite.tasksRoster`. The Tasks pkg's
`resolveRoster()` validates it and uses it for the owner-picker and reassign
dropdown. Without a roster file the pkg falls back to its static defaults —
setup is an upgrade, not a prerequisite.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) (monorepo root).

## Phase

WP-16 skeleton. Action bodies are dispatch stubs validated against the locked
`ActionFrontmatter` Zod (WP-06). Publish sync lands in WP-14.
