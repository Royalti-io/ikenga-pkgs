---
name: triage-inbox
description: Triage the inbox into buckets and draft reply decisions for operator approval. Zero writes from the skill.
domain: mail
ux_mode: approve
inputs_schema:
  type: object
  properties:
    since:
      type: string
      format: date-time
      description: Only triage messages received after this timestamp.
    max_messages:
      type: integer
      minimum: 1
      default: 50
      description: Maximum number of untriaged messages to process in one pass.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Mail Triage

    Read up to {{max_messages}} untriaged email messages (triage_category IS NULL
    or empty) received since {{since}} via host.dbQuery on the email_messages table.
    Enrich each with sender name from the contacts table.

    For each message, assign one of these triage buckets:
      - reply-now     : requires a reply from Chinedum (business-critical, time-sensitive)
      - delegate      : route to an agent or team member (use agent_handoffs pattern)
      - archive       : no action needed (automated, FYI, resolved)

    For every reply-now message, draft a reply decision:
      - Suggested reply body (tone: warm, concise — matching the established voice)
      - Suggested linked task if the thread implies an open action item (cross-ref tasks table)
      - Suggested send identity (royalti.io SMTP or getroyalti.com Resend — per lib/state.md rules)

    Present the full triage plan as a structured summary and PAUSE for operator
    approval. Do NOT write anything to ikenga.db — zero writes from this action.
    The mail pkg and host path own all writes on operator approval.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 8,12,17 * * 1-5"
    label: Weekday triage (8am / noon / 5pm)
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: triage-inbox

> The **WP-06 worked example, packaged.** The YAML frontmatter above is the
> action declaration (validates against `ActionFrontmatter`). This is the
> canonical form of the `triage-inbox` action defined in
> `06-skill-action-contract.md` §7 "Worked example A".

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` (SELECT-only):

- `email_messages` where `triage_category` IS NULL or blank — untriaged inbox
- `contacts` — sender names + organization for enrichment

Produces a structured triage plan — bucket assignments (reply-now / delegate /
archive) with draft reply decisions and linked-task suggestions for reply-now
items — and PAUSES (`ux_mode: approve`) for operator review before any
downstream state change.

This action produces decisions; it does NOT write them. The mail pkg owns all
writes. Zero `ikenga.db` writes from this skill action.

## Triage output format

```
=== Mail Triage — {n} messages since {since} ===

REPLY-NOW ({k} messages)
──────────────────────────
1. Valentim de Carvalho — "Re: Catalog import — files ready"
   Received: 2026-06-06 09:14
   Bucket: reply-now
   Draft reply: [reply text]
   Linked task: "Review catalog import for tenant 590" → assign to self
   Send via: royalti.io SMTP

2. LIRS · PAYE Reminder — "PAYE filing overdue — Feb 2024"
   Received: 2026-06-05 08:00
   Bucket: reply-now (regulatory — time-sensitive)
   Draft reply: [reply text]
   Linked task: "File PAYE — Feb 2024 onwards" → assign to Finance agent
   Send via: royalti.io SMTP

DELEGATE ({m} messages)
──────────────────────────
...

ARCHIVE ({p} messages)
──────────────────────────
...

=== Awaiting approval — zero writes until you confirm ===
```

## Source inventory rows absorbed

- `pa-assistant` agent (email triage — `/pa-triage` command)
- `/pa-triage` command (triage emails — single / bulk / untriaged / recheck)
- `/pa-inbox` command (inbox review — all actionable items)
- `pa:email-triage` cron (3× daily → absorbed as `schedule` trigger: `0 8,12,17 * * 1-5`)

## Relationship to `skill-pa triage(mode=inbox)`

`skill-pa`'s `triage` action accepts `mode: inbox` and covers the same
`email_messages` population, but in a cross-queue context (email + tasks
together in the PA briefing flow). `triage-inbox` is the **mail-domain-owned**
version: email-only focus, richer contact enrichment, reply-drafting built in.

The operator-visible distinction: `triage-inbox` surfaces from the **mail pane
Triage view**; `skill-pa triage(mode=inbox)` surfaces from the **PA surface**.
P5 dedup will reconcile — see README §P5-dedup note.

## Validation note

This action's frontmatter is byte-for-byte compatible with the WP-06 worked
example in `06-skill-action-contract.md` §7, plus:
- `max_messages` default raised from implied 50 to explicit `default: 50`.
- `cron` broadened from `"0 8 * * 1-5"` (morning only) to `"0 8,12,17 * * 1-5"`
  (3× daily) per the brief's `triggers` spec and the absorbed `pa:email-triage`
  cron pattern.
