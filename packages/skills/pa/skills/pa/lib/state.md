# pa — state contract

The table-scope declaration and read/write boundary every `skill-pa` action obeys.
Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** `host.dbExec` — parameterized mutate only for approved-send status
  transitions (see §Write scope below). All writes must be gated by an `approve`
  ux_mode pause — the operator confirms before any `dbExec` fires.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `tasks` | briefing, triage | Active/pending tasks — status, priority, assignee, due_date |
| `delegations` | triage | Outstanding delegations — who owns what, completion status |
| `agent_runs` | briefing | Recent agent execution history — status, output_summary |
| `agent_handoffs` | triage | Pending cross-domain handoffs awaiting resolution |
| `agent_reports` | briefing | Authored domain reports — summaries, key_metrics, alerts |
| `calendar_events` | briefing | Today/upcoming events — title, start_time, end_time |
| `email_messages` | briefing, triage | Inbox state — triage_category, received_at, from_address |
| `email_drafts` | send | Approved outbound drafts ready to dispatch — status = 'approved' |
| `email_replies` | triage | Pending reply drafts awaiting operator review |
| `notifications` | briefing | Recent notifications channel activity |

### Write tables (parameterized mutate via host.dbExec, approve-gated only)

| Table | Column(s) written | When | Gating |
|---|---|---|---|
| `email_drafts` | `status`, `sent_at`, `send_result` | After operator approves the send-list in `send` action | `ux_mode: approve` pause; operator explicitly confirms send-list |

**No other writes.** Tasks, delegations, agent_runs, calendar_events, email_messages
are read-only from this skill. CRUD for those tables belongs to the tasks pkg
and the mail pkg respectively.

---

## Dispatch scope (R4 — DISPATCH-ONLY)

Per R4 / WP-11 hard constraint: skill-pa is **dispatch-only**. The three core
dispatch verbs are:

1. **briefing** — read-only aggregation; no writes.
2. **triage** — read + produce triage decisions for operator approval; the triage
   decisions themselves are presented as a structured summary; any downstream
   state change (e.g. marking a task as reviewed) is performed by the tasks or
   mail pkg, not here.
3. **send** — read `email_drafts` where `status = 'approved'`; operator approves
   the send-list; on approval write `status = 'sent'` + `sent_at` + `send_result`
   to `email_drafts`. This is the one narrow write path.

**Zero CRUD verbs** — creating, editing, or deleting tasks/emails/delegations is
out of scope. Attempting to add CRUD to any action in this skill is a scope
violation (R4).

---

## Action-level capability declaration

Every action that touches the DB must declare `sqlite` in `requires_capabilities`:

```yaml
requires_capabilities:
  - sqlite    # reads ikenga.db via host.dbQuery; write via host.dbExec (approve-gated, send only)
  - chat      # drives the dock chat engine
```

The manifest's `permissions["sqlite.tables"]` is the coarse grant; the
`requires_capabilities: [sqlite]` in the action frontmatter is the action-level
assertion that these two layers cross-validate at install time.

---

## Setup instance file

`setup` writes a project-local instance file per the WP-06 `.atelier/<skill>/`
convention:

```
${CLAUDE_PROJECT_DIR}/.atelier/skill-pa/manifest.json
```

Shape:

```json
{
  "skill": "skill-pa",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "inbox_labels": ["INBOX"],
    "triage_buckets": ["reply-now", "delegate", "archive", "snooze"],
    "send_policy": "approve-before-send",
    "briefing_schedule": "07:00"
  }
}
```

`setup` carries `requires_capabilities: [fs, chat]` — `fs` to write the
instance file, `chat` for the confirm-in-chat conversation (D-02).
