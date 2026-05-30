---
name: send
description: Dispatch approved items from the email-drafts queue; operator confirms the send-list before any delivery commit.
domain: tasks
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    limit:
      type: integer
      minimum: 1
      default: 20
      description: Maximum approved drafts to surface in one send pass.
    delivery_system:
      type: string
      description: Filter to a specific delivery system (e.g. "resend", "listmonk"). Omit to surface all.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # PA Send Queue

    TODO (WP-12): Read `email_drafts` where `status = 'approved'` (optionally
    filtered by `delivery_system`) via host.dbQuery. Surface the send-list to
    the operator — subject, recipient, delivery_system, scheduled_for — and
    pause for explicit approval. On approval, write `status = 'sent'`, `sent_at`,
    `send_result` back to each approved row via host.dbExec (parameterized,
    one row at a time). This is the ONLY write path in skill-pa.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 9,17 * * *"
    label: Daily send dispatch (9am and 5pm)
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: send

> **WP-12 stub.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). The prose body lands in WP-12.

## What this action does (intent)

The one narrow write path in skill-pa.

**Read phase** (`host.dbQuery` — SELECT-only):
- `email_drafts` where `status = 'approved'` — approved outbound items ready to send

**Confirm** (`ux_mode: confirm`):
- Surface the send-list (subject, recipient summary, delivery_system, count)
- Single yes/no — the operator confirms the planned dispatch before it runs.
  (The drafts have *already* been approved upstream by `triage` / the mail pkg;
  `send` only confirms the dispatch intent — `confirm` gates before execution,
  whereas `approve` would gate after producing a fresh draft, which `send` does
  not do.)

**Write phase** (`host.dbExec` — approve-gated only):
- For each approved item: `UPDATE email_drafts SET status = 'sent', sent_at = ?, send_result = ? WHERE id = ?`
- No other table is written. No direct network call — the delivery system is
  downstream of the status transition (handled outside this skill).

## Write scope justification

This is the minimum write necessary for the send-dispatch surface (R4).
Marking a draft as `sent` is state tracking, not CRUD — the draft already exists
(created by the mail pkg). skill-pa only updates its delivery status.

## Source inventory rows lifted

- `/email-send-all` command (send all approved emails — Listmonk / Resend / SMTP)
- `pa:email-send-all` cron (daily 9am and 5pm → absorbed as `schedule` triggers above)
- `pa-assistant` agent (dispatch / queue execution role)
