# tasks — state contract

The table-scope declaration and read/write boundary every `skill-tasks` action
obeys. Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** Approved close-decisions dispatch **through the host write path**
  (not via skill code). The skill surfaces a structured decision list and pauses
  for operator approval; the host executes approved writes after the `approve`
  ux_mode gate.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `tasks` | setup (roster infer), sweep | Core task state — status, assigned_to, completed_at, outcome_notes, due_date |
| `agent_runs` | sweep | Recent agent execution history — completion signals cross-referenced to task outcomes |
| `delegations` | sweep | Outstanding delegations — completion status used as evidence for sweep decisions |

### Write tables

No direct DB writes from this skill. Approved close-decisions are dispatched
through the host write path after the `approve` gate — the host writes the
`tasks.status` / `tasks.completed_at` transition; the skill never calls
`host.dbExec` directly.

**No other writes.** Tasks CRUD belongs to the tasks app pkg exclusively (R4).

---

## Dispatch scope (R4 — DISPATCH-ONLY)

Per R4: skill-tasks is **dispatch-only**. The two verbs are:

1. **setup** — project-config only; no DB reads beyond optional infer_sources;
   writes the roster instance file (`.atelier/skill-tasks/roster.json`) via the
   `fs` capability. Zero DB writes.
2. **sweep** — read-only aggregation from `tasks` + evidence tables;
   produces structured close-decision candidates; pauses for operator approval.
   Approved decisions are committed by the host, not the skill.

**Zero CRUD verbs** — creating, editing, or deleting tasks is out of scope.
Adding CRUD to any action in this skill is a scope violation (R4).

---

## Action-level capability declaration

Every action that touches the DB must declare `sqlite` in `requires_capabilities`:

```yaml
requires_capabilities:
  - sqlite    # reads ikenga.db via host.dbQuery
  - chat      # drives the dock chat engine
```

The manifest's `permissions["sqlite.tables"]` is the coarse grant; the
`requires_capabilities: [sqlite]` in the action frontmatter is the action-level
assertion. Both layers cross-validate at install time.

The `setup` action does NOT need `sqlite` (roster infer from repo context only;
no DB read required). It carries `requires_capabilities: [fs, chat]`.

---

## Roster instance file

`setup` writes two project-local instance files per the WP-06 `.atelier/<skill>/`
convention:

```
${CLAUDE_PROJECT_DIR}/.atelier/skill-tasks/manifest.json   ← skill instance config
${CLAUDE_PROJECT_DIR}/.atelier/skill-tasks/roster.json     ← roster payload (WP-10 contract)
```

### manifest.json shape

```json
{
  "skill": "skill-tasks",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "sweep_cron": "30 */4 * * *",
    "sweep_lookback_days": 14,
    "close_after_days_done": 7
  }
}
```

### roster.json shape (WP-10 contract)

```json
{
  "humans": [
    { "value": "alice@acme.com", "label": "Alice" }
  ],
  "agents": [
    { "id": "finance-agent", "label": "Finance" }
  ]
}
```

Both arrays must be non-empty for the shell to treat the roster as valid.
A missing key, empty array, or malformed entry causes `resolveRoster` to return
`null` and the static fallback to remain active.

`setup` carries `requires_capabilities: [fs, chat]` — `fs` to write both
instance files, `chat` for the confirm-in-chat conversation (D-02).
