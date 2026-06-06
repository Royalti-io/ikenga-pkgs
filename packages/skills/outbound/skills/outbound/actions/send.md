---
name: send
description: "R22 outbound-send owner. Surface approved outbound drafts across all four channels (email/newsletter/sequences/social) for operator approval; on approval, commit delivery-status transition via host.dbExec; 10-second undo window. Transport executes via the host dispatch path, never the skill."
domain: outbound
ux_mode: approve
inputs_schema:
  type: object
  properties:
    limit:
      type: integer
      minimum: 1
      default: 20
      description: Maximum approved drafts to surface per channel in one send pass.
    channel:
      type: string
      enum: ["email", "newsletter", "sequences", "social", "all"]
      default: "all"
      description: "Filter to a specific outbound channel. 'all' surfaces approved drafts across all four channels."
    delivery_system:
      type: string
      enum: ["listmonk", "resend", "smtp", "buffer"]
      description: "Optional: filter to a specific delivery system within the channel."
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Outbound Send Queue (R22 — outbound-channel owner)

    Read approved outbound drafts across the requested channel(s) and surface
    them for operator approval. On approval, commit delivery-status transitions.

    ## Step 1 — Read approved drafts (host.dbQuery — SELECT-only)

    Read up to {{limit}} approved items per channel, filtered by {{channel}}
    (default: all channels) and optionally by {{delivery_system}}:

    **Email channel** (if channel is 'email' or 'all'):
    - `email_drafts` WHERE status = 'approved'
      AND delivery_system IN ('smtp', 'resend', 'listmonk')
      AND (source != 'mail-reply' OR source IS NULL)  -- outbound-flagged only
      ORDER BY scheduled_for ASC NULLS LAST
      LIMIT {{limit}}

    **Newsletter channel** (if channel is 'newsletter' or 'all'):
    - `newsletter_sends` WHERE status = 'approved' (draft state awaiting commit)
      ORDER BY scheduled_for ASC NULLS LAST LIMIT {{limit}}
    - Check cooling period: for each newsletter row, verify that the cooling
      period (from setup config; default 60 minutes) has elapsed since the last
      sent edition for the same draft_slug. Flag any cooling violations.

    **Sequences channel** (if channel is 'sequences' or 'all'):
    - `outbound_sequences` WHERE status = 'approved' AND next_send_date <= NOW()
      ORDER BY next_send_date ASC LIMIT {{limit}}
    - Join `email_sequences` for sequence name and delivery_system.
    - Join `contacts` for contact_email display name.

    **Social channel** (if channel is 'social' or 'all'):
    - `social_queue` WHERE status = 'approved'
      ORDER BY scheduled_for ASC NULLS LAST LIMIT {{limit}}

    **Boundary note (R22):** Do NOT read email_drafts rows where source =
    'mail-reply'. Those belong to `skill-pa send` (non-outbound queue). The
    outbound/reply split is on the source or delivery_system column — only
    outbound-channel rows are in scope here.

    ## Step 2 — Surface the send-list

    Format the send-list as a structured summary grouped by channel:

    ```
    === Outbound Send Queue — {total} items across {n} channels ===

    EMAIL ({k} items)
    ──────────────────
    1. "Re: Royalti onboarding · file processing" → Valentim de Carvalho
       via: royalti.io SMTP · scheduled: 2h overdue ⚠
    2. "Welcome — your Royalti tenant is ready" → {{first_name}} (Resend batch)
       via: getroyalti.com Resend · scheduled: Today 14:30

    NEWSLETTER ({m} items)
    ──────────────────────
    1. "Schema patches that unblocked tenant 590" → 2,104 recipients
       via: royalti.io Listmonk · quality: 86/100 ✓ · cooling: elapsed ✓
    ⚠ COOLING VIOLATION: "Investor Update — May" → cooling: 23m remaining

    SEQUENCES ({p} items)
    ─────────────────────
    1. "seq3-universal-pt" → ar@universalmusic.pt · Step 2/5 (Day 3)
       via: getroyalti.com Resend [cold] · next_send_date: NOW
    2. "onboard-welcome" → new_tenant@example.com · Step 1/3
       via: royalti.io Listmonk · next_send_date: NOW

    SOCIAL ({q} items)
    ──────────────────
    1. LinkedIn · @royalti — "Announcing our new workspace..." · Today 10:00
    2. X · @royalti — Thread 7 posts · Tue 09:00

    === Approve all? Or specify items to approve individually. ===
    === 10-second undo window applies after approval commit. ===
    ```

    Highlight any cooling violations or overdue items prominently.

    ## Step 3 — Pause for approval (ux_mode: approve)

    PAUSE here. Do not commit anything until the operator approves.
    The operator may:
    - Approve all items
    - Approve a subset (specify by number or channel)
    - Reject / defer specific items
    - Exit without approving (no writes)

    ## Step 4 — Commit delivery-status transitions (host.dbExec — on approval only)

    For each approved item, commit the delivery-status transition (parameterized,
    one row at a time, inside the 10-second undo window):

    **Email drafts (approved):**
    UPDATE email_drafts
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP, send_result = 'dispatched'
    WHERE id = ?

    **Newsletter sends (approved):**
    INSERT INTO newsletter_sends
      (draft_slug, edition, subject, delivery_system, sent_at, recipient_count)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)

    **Sequences (step advance, approved):**
    UPDATE outbound_sequences
    SET current_step = current_step + 1,
        next_send_date = ?,
        status = CASE WHEN current_step + 1 >= total_steps THEN 'completed' ELSE 'active' END,
        sent_count = sent_count + 1
    WHERE id = ?

    **Social queue (approved):**
    UPDATE social_queue
    SET status = 'posted', posted_at = CURRENT_TIMESTAMP
    WHERE id = ?

    **Fundraising outreach (if present in email channel):**
    UPDATE fundraising_outreach
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP
    WHERE id = ?

    These writes mark delivery status only. No CRUD. No direct transport call —
    the host dispatch path (approve-gate, 10-second undo window) executes the
    actual delivery downstream of the status transition.

    After committing, report the number of items committed per channel.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 9,17 * * *"
    label: Daily outbound dispatch (9am and 5pm)
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: send

> **R22 outbound-send owner.** The YAML frontmatter above is the action
> declaration (validates against `ActionFrontmatter`). This action absorbs the
> four outbound channels' dispatch from `skill-pa send` per the Round 22 founder
> decision.

## What this action does (intent)

The one write path in skill-outbound — and the canonical outbound-send owner.

**Read phase** (`host.dbQuery` — SELECT-only):
- `email_drafts` where `status = 'approved'` AND outbound-flagged (not mail-reply)
- `newsletter_sends` where `status = 'approved'` (with cooling-period check)
- `outbound_sequences` where `status = 'approved'` AND `next_send_date <= NOW()`
- `social_queue` where `status = 'approved'`
- `fundraising_outreach` where `status = 'approved'` (cold-outreach email channel)

**Approve** (`ux_mode: approve`):
- Surface the send-list grouped by channel (email/newsletter/sequences/social)
- Highlight overdue items, cooling violations, cold-sender sequences
- Pause — the operator approves all, a subset, or exits
- 10-second undo window: the approved-drafts commit is held for 10s before
  the host dispatch path fires

**Write phase** (`host.dbExec` — approve-gated only):
- For each approved item: UPDATE the delivery-status column in the relevant table
- No direct network/transport call — the host dispatch path executes actual delivery
- No other table is written beyond the delivery-status fields listed above

## R22 send boundary

This is the canonical split between `skill-outbound send` and `skill-pa send`:

| Boundary | This action | skill-pa send |
|----------|-------------|---------------|
| Channels | newsletter, email-campaign, cold-outreach, sequences, social | mail-replies only |
| Tables | email_drafts (outbound), newsletter_sends, outbound_sequences, social_queue, fundraising_outreach | email_drafts (reply-flagged only) |
| Source tag | delivery_system in ('listmonk','resend','smtp-campaign') OR source != 'mail-reply' | source = 'mail-reply' OR delivery_system = 'smtp-reply' |

`skill-pa send` retains its original scope for mail replies. This action is
**additive**: it owns the outbound-channel side that was previously undeclared in
skill-pa.

## Write scope justification

The delivery-status write is the minimum necessary for the send-dispatch surface
(R4). Marking a draft as `sent` / `posted` / `completed` is state tracking, not
CRUD — the draft/sequence/post already exists (created by the outbound pkg).
skill-outbound only updates the delivery status.

## Source inventory rows absorbed

- `/pa-outbound-send` command (send all approved outbound items)
- `pa:outbound-dispatch` cron (daily 9am and 5pm → absorbed as `schedule`
  triggers above: `0 9,17 * * *`)
- Newsletter send dispatch (Listmonk batch commit)
- Resend cold-outreach dispatch (getroyalti.com)
- Sequence step advance (outbound_sequences current_step++)
- Social post commit (Buffer / LinkedIn / X)
- `pa-assistant` agent (outbound dispatch / queue execution role)
