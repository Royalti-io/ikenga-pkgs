# mail — state contract

The table-scope declaration and read/write boundary every `skill-mail` action obeys.
Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** `host.dbExec` — **not used by any skill-mail action.** The mail pkg
  (`com.ikenga.mail`) owns all writes to `ikenga.db` tables. skill-mail only
  produces drafts and decisions; the mail pkg / host path executes writes on
  operator approval.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `email_messages` | triage-inbox, draft-reply | Inbound messages — `id`, `inbox_source`, `subject`, `from_address`, `to_address`, `body_text`, `triage_category`, `triage_reason`, `received_at`. `triage-inbox` reads rows where `triage_category` IS NULL or empty; `draft-reply` reads the selected thread's messages. |
| `email_replies` | draft-reply | Chi-drafted reply drafts — `id`, `reply_to_message_id`, `classification`, `subject`, `body`, `body_format`, `from_name`, `from_email`, `delivery_system`. `draft-reply` reads existing drafts for the thread to avoid duplication. |
| `email_drafts` | triage-inbox | Operator-authored unsent drafts — `id`, `subject`, `body`, `from_name`, `from_email`. `triage-inbox` reads draft count to avoid double-triage. |
| `contacts` | triage-inbox, draft-reply | Sender display names + lookup — `id`, `email`, `name`, `organization`. Used to enrich triage buckets and personalise drafted replies. |

### Write tables

**None.** skill-mail makes zero writes to `ikenga.db`. All writes are owned
by the mail pkg (`com.ikenga.mail`) via `host.dbExec` on operator approval.

The `email_replies` write path (inserting a drafted reply) is performed by the
mail pkg's quick-reply surface, NOT this skill. `draft-reply` produces the
reply text as an `approve`-gated artifact; the mail pkg inserts it.

---

## Dispatch scope (R4 — DISPATCH-ONLY)

skill-mail is dispatch-only. The three dispatch verbs are:

1. **setup** — project-config write only (`.atelier/skill-mail/manifest.json`
   via the `fs` capability); no `ikenga.db` reads or writes.
2. **triage-inbox** — read-only aggregation of untriaged `email_messages` +
   `contacts`; produces structured triage decisions (bucket assignments, linked-task
   suggestions) for operator approval. Zero `ikenga.db` writes.
3. **draft-reply** — read thread context from `email_messages` + `contacts` +
   `email_replies`; produces a reply draft for the quick-reply surface; operator
   confirms before the mail pkg inserts the `email_replies` row.

**Zero CRUD verbs** — creating, editing, or deleting emails, marking read/unread,
snoozing, or tagging is out of scope. Attempting to add CRUD to any action in
this skill is a scope violation (R4).

---

## Action-level capability declaration

Every action that reads `ikenga.db` must declare `sqlite` in `requires_capabilities`:

```yaml
requires_capabilities:
  - sqlite    # reads ikenga.db via host.dbQuery (SELECT-only)
  - chat      # drives the dock chat engine
```

The manifest's `permissions["sqlite.tables"]` is the coarse grant; the
`requires_capabilities: [sqlite]` in the action frontmatter is the action-level
assertion that the two layers cross-validate at install time.

`setup` does NOT declare `sqlite` — it only writes the `.atelier` instance file
via the `fs` capability, and does not read `ikenga.db`.

---

## Inbox-source + send-identity config (setup instance file)

`setup` writes a project-local instance file per the WP-06 `.atelier/<skill>/`
convention:

```
${CLAUDE_PROJECT_DIR}/.atelier/skill-mail/manifest.json
```

Shape:

```json
{
  "skill": "skill-mail",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "inbox_sources": ["royalti.io/INBOX"],
    "send_identities": [
      {
        "domain": "royalti.io",
        "delivery_system": "smtp",
        "from_name": "Chinedum Okerengwor",
        "from_email": "hello@royalti.io"
      },
      {
        "domain": "getroyalti.com",
        "delivery_system": "resend",
        "from_name": "Royalti",
        "from_email": "hello@getroyalti.com",
        "note": "cold-outreach only"
      }
    ],
    "triage_buckets": ["reply-now", "delegate", "archive"],
    "default_signature": "— sent from Ikenga"
  }
}
```

**Send-identity rules:**
- `royalti.io` addresses route through Listmonk/SMTP (transactional + replies).
- `getroyalti.com` addresses route through Resend (cold-outreach ONLY).
- skill-mail never initiates a send — it drafts. The delivery_system field
  informs the mail pkg which path to use when the operator approves a draft reply.

`setup` carries `requires_capabilities: [fs, chat]` — `fs` to write the
instance file, `chat` for the confirm-in-chat conversation (D-02).

---

## mail pane event contract

The mail pane (`com.ikenga.mail`) listens for a `skill.setup.complete` event
(dispatched via the AppBridge shell event channel) on successful `setup` completion.
On receipt, the pane re-reads its skill-mail config and re-renders with the newly
localised inbox source and send identity. No polling — event-driven only.

skill-mail dispatches `skill.setup.complete` after writing the instance file.
The event payload carries `{ skill: "skill-mail", template_version: 1 }`.
