---
name: draft-reply
description: Draft a reply for the selected email thread into the quick-reply surface. The email_replies write happens via the mail pkg on operator send.
domain: mail
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    message_id:
      type: string
      description: The id of the email_messages row to reply to.
    tone:
      type: string
      enum: [warm, formal, brief]
      default: warm
      description: Tone of the drafted reply.
    context:
      type: string
      description: Optional operator context or instructions to incorporate into the draft.
  required:
    - message_id
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft Reply

    Draft a reply for the email thread whose head message has id={{message_id}}.

    Steps:
    1. Read the full thread (all messages in email_messages where the thread shares
       the same subject/from chain, ordered by received_at) via host.dbQuery.
    2. Look up the sender in the contacts table to personalise the greeting.
    3. Check email_replies for any existing draft for this message_id to avoid
       duplicate drafts.
    4. Read .atelier/skill-mail/manifest.json to determine the correct send identity
       (royalti.io SMTP or getroyalti.com Resend).
    5. Draft a reply with tone={{tone}}, incorporating {{context}} if provided.
       Target length: 3–6 lines, matching the voice established in the thread.
       End with the configured default_signature.

    Present the drafted reply and PAUSE for operator confirmation (ux_mode: confirm).
    Do NOT write to email_replies — the mail pkg / host path handles that write
    when the operator approves. Zero writes from this action.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: draft-reply

The reply-drafting action for skill-mail. `ux_mode: confirm` — previews the
drafted reply for the operator before the mail pkg inserts the `email_replies`
row and surfaces it in the quick-reply textarea.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` (SELECT-only):

- `email_messages` — the full thread (head message + prior messages in the thread)
- `contacts` — sender name + organization for personalised greeting
- `email_replies` — existing drafts for this message_id (avoid duplication)

Produces a single drafted reply and PAUSES (`ux_mode: confirm`) for the operator
to confirm, edit, or reject before any write happens. The `email_replies` INSERT
is owned by the mail pkg's quick-reply surface — NOT by this skill.

## Output format

```
=== Draft reply for: "{subject}" ===
From: {sender_name} <{from_address}>
Thread: {message_count} messages · last received {received_at}

--- DRAFTED REPLY ---
{reply body}
— sent from Ikenga

Send via: {delivery_system} ({from_email})
---

Confirm to insert into quick-reply surface, or edit before confirming.
```

## Write boundary

**This action writes nothing.** The `email_replies` INSERT is performed by
the mail pkg (`com.ikenga.mail`) via `host.dbExec` on operator approval through
the quick-reply surface. The seam is:

```
skill-mail draft-reply (produces reply text, ux_mode: confirm)
    ↓
operator confirms
    ↓
mail pkg inserts email_replies row (reply_to_message_id, subject, body,
    body_format, from_name, from_email, delivery_system, classification)
    ↓
quick-reply textarea pre-populated; operator clicks Send or edits
    ↓
mail pkg / host path delivers via configured delivery_system
```

## Source inventory rows absorbed

- Chi dock-chat "Draft reply" action (mail pane `D-01` dock-chat strip action)
- `⌘R` "Regenerate reply" shortcut (re-run this action to produce a new draft)
- Quick-reply surface pre-population (fixture M-01 Chi analysis → reply draft)
