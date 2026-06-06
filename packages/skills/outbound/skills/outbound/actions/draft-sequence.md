---
name: draft-sequence
description: Draft drip or cold-outreach step content following the 06 §Pipeline-stages convention; pause for operator approval. Zero writes.
domain: outbound
ux_mode: approve
inputs_schema:
  type: object
  properties:
    sequence_id:
      type: string
      description: The id of the email sequence to draft a step for (from email_sequences.id).
    step_number:
      type: integer
      minimum: 1
      description: Which step in the sequence to draft (1-indexed).
    contact_email:
      type: string
      format: email
      description: "Optional: draft for a specific recipient (personalisation context from contacts)."
    step_type:
      type: string
      enum: ["outreach", "follow-up", "nurture", "winback", "onboarding"]
      description: "The intent of this step — informs tone and CTA."
    delay_hint:
      type: string
      description: "Optional: override the sequence's default step delay (e.g. 'Day 3', 'Week 2')."
  required:
    - sequence_id
    - step_number
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft Sequence Step

    Draft step {{step_number}} for sequence {{sequence_id}}.
    Step type: {{step_type}} (if provided)
    Recipient: {{contact_email}} (if provided — use for personalisation)
    Delay hint: {{delay_hint}} (if provided)

    ## Step 1 — Context reads (host.dbQuery — SELECT-only)

    Read the following to anchor the draft:
    - `email_sequences` WHERE id = {{sequence_id}}: sequence definition —
      name, slug, segment, total_steps, step_delays, delivery_system, status.
      Verify the sequence is active (status != 'paused' or 'archived').
    - `outbound_sequences` WHERE sequence_id = {{sequence_id}}: per-recipient
      tracking rows — current_step, status, last_reply_at — for the named
      contact if {{contact_email}} is provided, otherwise aggregate stats.
    - `contacts` WHERE email = {{contact_email}} (if provided): name,
      organization — for personalisation.

    ## Step 2 — Pipeline-stages alignment (06 §Pipeline-stages, R-04)

    Map the step to the outbound pipeline stage:
    - Outreach (step 1): cold open — introduce value, no hard ask.
    - Follow-up (steps 2–3): social proof + gentle ask.
    - Nurture (steps 4+): deeper value, case-studies, positioning.
    - Winback: acknowledge gap, re-offer value.
    - Onboarding: product guidance, success milestone framing.

    Use the delivery_system from the sequence definition to select the correct
    send identity (from setup config):
    - listmonk → royalti.io identity (newsletter/transactional)
    - resend → getroyalti.com identity (cold-outreach ONLY; confirm step_type
      is appropriate for cold-outreach before using this identity)

    ## Step 3 — Draft production

    Produce the step draft:
    - Subject line (personalised if contact context is available)
    - Opening sentence (personalised if contact name/org is available)
    - Body copy (concise; 2–3 paragraphs max; Royalti voice — warm, precise)
    - CTA (single, matches step_type intent)
    - Delay from previous step (from sequence step_delays, or {{delay_hint}})

    Cold-sender risk note: if delivery_system is `resend` and step_type is
    `outreach` or `follow-up`, add a `.ob-chip.sender.cold` risk annotation to
    the draft artifact (matching the cold-sender reputational-risk signal in the
    outbound pane fixture).

    ## Step 4 — Pause

    Present the full step draft to the operator and PAUSE (`ux_mode: approve`).
    Do NOT write anything to ikenga.db — zero writes from this action.
    The outbound pkg and `skill-outbound send` own all writes on approval.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: draft-sequence

Draft-and-approve lifecycle for drip and cold-outreach sequence steps, following
the `06` §Pipeline-stages convention (R-04, resolved-by-convention). ux_mode:
approve — the draft is produced first, then paused for operator review before any
delivery commit.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` (SELECT-only):

- `email_sequences` — sequence definition (name, delivery system, total steps,
  step delays).
- `outbound_sequences` — per-recipient tracking (current step, status, last reply).
- `contacts` — recipient personalisation (name, organization).

Produces a structured sequence-step draft — subject, personalised body, CTA,
cold-sender risk annotation (where applicable) — and PAUSES (`ux_mode: approve`)
for operator review before any downstream state change.

This action produces the draft artifact; it does NOT write it. The outbound pkg
and `skill-outbound send` own all writes. Zero `ikenga.db` writes from this
action.

## Pipeline-stages alignment (06 §Pipeline-stages, R-04)

Following the R-04 pipeline-stages convention: sequence steps map to outbound
pipeline positions. The skill does NOT maintain stage-transition records — those
belong to the outbound pkg's `outbound_sequences` table writes. The skill only
produces the step content aligned to the current stage position.

Stage-to-delivery-system rules:
- `listmonk` delivery: royalti.io identity — newsletter/transactional sequences.
- `resend` delivery: getroyalti.com identity — **cold-outreach ONLY**. If
  step_type is `nurture` or `onboarding` (warm/existing-relationship steps),
  warn the operator that the getroyalti.com/Resend identity is configured for
  cold-outreach; they should confirm this is intentional.

## Cold-sender risk signal

When delivery_system is `resend` and step_type is `outreach` or `follow-up`, the
draft artifact includes a cold-sender risk annotation. This mirrors the
`.ob-chip.sender.cold` chip shown in the outbound pane fixture — a reputational-
risk signal (`--achievement` text) alerting the operator to deliverability risk
on cold sequences. The annotation is informational only; it does not block the
draft or the send.

## Source inventory rows absorbed

- Drip-sequence step authoring (sequence domain, R22 scope)
- Cold A&R outreach drafts (e.g. `seq3-universal-pt` fixture: cold outreach to
  `ar@universalmusic.pt`)
- Winback sequence step authoring (e.g. `l5-winback` fixture: 388-recipient
  churned cohort)
- Onboarding sequence steps (e.g. `onboard-welcome` fixture: new tenants, Resend)
