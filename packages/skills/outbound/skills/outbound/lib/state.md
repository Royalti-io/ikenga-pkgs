# outbound — state contract

The table-scope declaration and read/write boundary every `skill-outbound` action obeys.
Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** `host.dbExec` — used **exclusively** by the `send` action, and only
  to commit delivery-status transitions on approved drafts (parameterized UPDATE, one
  row at a time). All other skill-outbound actions (draft-campaign, draft-sequence,
  draft-social) produce artifacts for operator review; they write nothing.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `email_sequences` | draft-sequence, send | Sequence definitions — `id`, `name`, `slug`, `segment`, `total_steps`, `step_delays`, `delivery_system`, `status`. `draft-sequence` reads the sequence definition to author step content; `send` reads active sequence state. |
| `outbound_sequences` | draft-sequence, send | Per-recipient sequence tracking — `id`, `deal_id`, `contact_email`, `sequence_id`, `segment`, `current_step`, `total_steps`, `next_send_date`, `status`, `sent_count`, `last_reply_at`, `pause_reason`. Used to check sequence position and next-step timing. |
| `fundraising_outreach` | draft-campaign, send | Cold-outreach / fundraising email approvals — `id`, `deal_id`, `channel`, `subject`, `body`, `status`, `drafted_by`, `approved_by`, `approved_at`, `rejected_reason`, `sent_at`. `draft-campaign` reads context; `send` reads approved rows. |
| `newsletter_sends` | draft-campaign, send | Newsletter send history — `id`, `draft_slug`, `edition`, `subject`, `delivery_system`, `sent_at`, `recipient_count`, `open_rate`, `click_rate`. Used by `draft-campaign` for cooling-period check and quality context; by `send` for send-list context. |
| `social_queue` | draft-social, send | Social posts — `id`, `platform`, `account`, `content`, `status`, `scheduled_for`, `approved_at`, `approved_by`, `posted_at`, `source`. `draft-social` reads scheduling context; `send` reads approved rows. |
| `email_drafts` | send | Outbound-flagged approved drafts — `id`, `subject`, `body`, `from_name`, `from_email`, `delivery_system`, `status`, `scheduled_for`. `send` reads rows where `status = 'approved'` AND the row is outbound-channel-sourced (not a mail reply — see §Send-boundary below). |
| `contacts` | draft-campaign, draft-sequence, draft-social | Recipient display names + segment membership — `id`, `email`, `name`, `organization`. Used for personalisation in campaign and sequence drafts. |

### Write tables

**All writes are owned by the `send` action only — and only on operator approval.**

| Table | Written by | Write operation |
|---|---|---|
| `email_drafts` | `send` (outbound-flagged rows) | `UPDATE email_drafts SET status = 'sent', sent_at = ?, send_result = ? WHERE id = ?` (parameterized, one row at a time) |
| `fundraising_outreach` | `send` | `UPDATE fundraising_outreach SET status = 'sent', sent_at = ? WHERE id = ?` |
| `newsletter_sends` | `send` | INSERT of a new sent-log row after delivery commit: `INSERT INTO newsletter_sends (draft_slug, edition, subject, delivery_system, sent_at, recipient_count) VALUES (...)` |
| `social_queue` | `send` | `UPDATE social_queue SET status = 'posted', posted_at = ? WHERE id = ?` |
| `outbound_sequences` | `send` (step advance) | `UPDATE outbound_sequences SET current_step = ?, next_send_date = ?, status = ? WHERE id = ?` |

These writes mark delivery status; they do not create or delete records.
**No CRUD.** The outbound pkg (`com.ikenga.outbound`) owns all entity CRUD.

**draft-campaign, draft-sequence, draft-social make zero writes.** Their output
is an artifact paused for operator review. All DB writes on approval belong to
the `send` action or the outbound pkg.

---

## Send-boundary (R22 — outbound vs. mail-reply split)

The `email_drafts` table is shared between two skills:

| Skill | Reads | Writes | Scope |
|---|---|---|---|
| `skill-pa send` | `email_drafts` (reply-flagged rows) | UPDATE `status = 'sent'` | **Mail replies only** — drafts produced by `triage-inbox` / `draft-reply` for inbound thread responses |
| `skill-outbound send` | `email_drafts` (outbound-flagged rows) + 4 other tables | UPDATE `status = 'sent'` + writes to the other 4 tables | **Outbound channels** — campaign emails, drip steps, cold-outreach, newsletter |

The distinguishing column is `email_drafts.delivery_system` and/or a
`email_drafts.source` tag (implementation detail for WP-19b domain pkg schema).
Until that column is available in `tables.json`, `skill-outbound send` reads all
rows where `status = 'approved'` and `delivery_system` is an outbound system
(`resend`, `listmonk`, `smtp-campaign`) — not `smtp-reply`.

---

## Dispatch scope (R4 — DISPATCH-ONLY)

skill-outbound is dispatch-only. The five dispatch verbs are:

1. **setup** — project-config write only (`.atelier/skill-outbound/manifest.json`
   via the `fs` capability); no `ikenga.db` reads or writes.
2. **draft-campaign** — reads `newsletter_sends` + `fundraising_outreach` +
   `contacts` via `host.dbQuery`; produces a campaign draft artifact + quality
   scorecard for operator approval. Zero `ikenga.db` writes.
3. **draft-sequence** — reads `email_sequences` + `outbound_sequences` + `contacts`
   via `host.dbQuery`; produces a sequence-step draft artifact for operator
   approval. Zero `ikenga.db` writes.
4. **draft-social** — reads `social_queue` + `contacts` via `host.dbQuery`;
   produces social post candidates; operator confirms before the outbound pkg
   inserts the `social_queue` row. Zero `ikenga.db` writes.
5. **send** — the one write path. Reads approved outbound drafts across all four
   channels via `host.dbQuery`; commits delivery-status transitions via
   `host.dbExec` on operator approval; never calls transport directly.

**Zero CRUD verbs** — creating, editing, or deleting sequences, campaigns,
contacts, social accounts is out of scope. Attempting to add CRUD to any action
in this skill is a scope violation (R4).

---

## Action-level capability declaration

Every action that reads or writes `ikenga.db` must declare `sqlite` in
`requires_capabilities`:

```yaml
requires_capabilities:
  - sqlite    # reads/writes ikenga.db via host.dbQuery / host.dbExec
  - chat      # drives the dock chat engine
```

`setup` does NOT declare `sqlite` — it only writes the `.atelier` instance file
via the `fs` capability, and does not read `ikenga.db`.

---

## Channel identity config (setup instance file)

`setup` writes a project-local instance file per the WP-06 `.atelier/<skill>/`
convention:

```
${CLAUDE_PROJECT_DIR}/.atelier/skill-outbound/manifest.json
```

Shape:

```json
{
  "skill": "skill-outbound",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "send_identities": [
      {
        "domain": "royalti.io",
        "delivery_system": "listmonk",
        "from_name": "Royalti",
        "from_email": "hello@royalti.io",
        "note": "newsletter + transactional sequences"
      },
      {
        "domain": "royalti.io",
        "delivery_system": "smtp",
        "from_name": "Chinedum Okerengwor",
        "from_email": "hello@royalti.io",
        "note": "direct outbound email"
      },
      {
        "domain": "getroyalti.com",
        "delivery_system": "resend",
        "from_name": "Royalti",
        "from_email": "hello@getroyalti.com",
        "note": "cold-outreach ONLY — never reply path"
      }
    ],
    "social_creds": {
      "linkedin": { "connected": false },
      "x": { "connected": false },
      "buffer": { "connected": false }
    },
    "quality_threshold": 75,
    "cooling_period_minutes": 60
  }
}
```

**Send-identity rules:**
- `royalti.io` routes through Listmonk (newsletters) or SMTP (direct outbound).
- `getroyalti.com` routes through Resend for **cold-outreach ONLY** — never the
  reply path (that belongs to `skill-mail` / `skill-pa`).
- Social credentials are checked for presence (OAuth connected flag); the skill
  never stores OAuth tokens — those live in the shell Stronghold vault.

`setup` carries `requires_capabilities: [fs, chat, secrets]` — `fs` to write the
instance file, `chat` for the confirm-in-chat conversation (D-02), `secrets` to
probe the Stronghold vault for social OAuth token presence.

---

## Outbound pane event contract

The outbound pane (`com.ikenga.outbound`) listens for a `skill.setup.complete`
event (dispatched via the AppBridge shell event channel) on successful `setup`
completion. On receipt, the pane re-reads its skill-outbound config and re-renders
with the newly localised channel identities. No polling — event-driven only.

skill-outbound dispatches `skill.setup.complete` after writing the instance file.
The event payload carries `{ skill: "skill-outbound", template_version: 1 }`.
