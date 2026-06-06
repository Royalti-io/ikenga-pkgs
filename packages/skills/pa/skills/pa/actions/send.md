---
name: send
description: "NON-OUTBOUND ONLY (R22): Dispatch approved mail-reply drafts from the email-drafts queue; operator confirms the send-list before any delivery commit. Outbound channels (newsletter/campaigns/sequences/social) are owned by skill-outbound send."
domain: tasks
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    limit:
      type: integer
      minimum: 1
      default: 20
      description: Maximum approved mail-reply drafts to surface in one send pass.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # PA Send Queue (mail-replies only — R22)

    SCOPE (R22 boundary): This action handles NON-OUTBOUND approved drafts ONLY —
    mail replies queued in email_drafts from the mail triage / draft-reply flow.
    Outbound-channel sends (newsletter, campaigns, sequences, social) are owned
    by `skill-outbound send`. Do NOT surface email_drafts rows where
    delivery_system is 'listmonk', 'resend', or 'smtp-campaign', or where
    source = 'outbound'. Those belong to skill-outbound.

    TODO (WP-12): Read `email_drafts` where `status = 'approved'`
    AND (source = 'mail-reply' OR delivery_system = 'smtp-reply' OR delivery_system = 'smtp')
    via host.dbQuery. Surface the send-list to the operator — subject, recipient,
    delivery_system, scheduled_for — and pause for explicit approval. On approval,
    write `status = 'sent'`, `sent_at`, `send_result` back to each approved row
    via host.dbExec (parameterized, one row at a time).
    This is the ONLY write path in skill-pa, scoped to mail replies.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 9,17 * * *"
    label: Daily mail-reply dispatch (9am and 5pm)
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: send

> **WP-12 stub.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). The prose body lands in WP-12.

> **R22 scope narrowing (WP-19a):** This action is narrowed to **mail replies
> only**. Outbound-channel dispatch (newsletter/campaigns/sequences/social) is
> absorbed by `skill-outbound send` per the Round 22 founder decision.
> See `packages/skills/outbound/README.md` and
> `packages/skills/outbound/skills/outbound/actions/send.md` for the outbound
> send owner documentation.

## What this action does (intent)

The one narrow write path in skill-pa — **mail-reply drafts only**.

**Read phase** (`host.dbQuery` — SELECT-only):
- `email_drafts` where `status = 'approved'` AND (source = 'mail-reply' OR
  delivery_system = 'smtp-reply' OR delivery_system = 'smtp') — mail-reply
  drafts produced by `triage-inbox` / `draft-reply` in the mail flow.
- **NOT** outbound-channel rows (delivery_system in 'listmonk'/'resend'/
  'smtp-campaign', or source = 'outbound'). Those belong to `skill-outbound send`.

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
(created by the mail pkg). skill-pa only updates its delivery status, scoped
to the mail-reply channel.

## Source inventory rows lifted

- `/email-send-all` command (send approved mail-reply emails — SMTP)
- `pa:email-send-all` cron (daily 9am and 5pm → absorbed as `schedule` triggers above)
- `pa-assistant` agent (mail-reply dispatch role)

## R22 cross-reference

| This action scope | skill-outbound send scope |
|---|---|
| `email_drafts` (mail-reply, source='mail-reply') | `email_drafts` (outbound, source='outbound' or delivery_system='listmonk'/'resend') |
| — | `newsletter_sends` (approved campaigns) |
| — | `outbound_sequences` (step advance) |
| — | `social_queue` (approved posts) |
| — | `fundraising_outreach` (cold-outreach) |
