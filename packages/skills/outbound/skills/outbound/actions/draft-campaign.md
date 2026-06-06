---
name: draft-campaign
description: Draft newsletter or email campaign copy with quality-score scorecard and cooling-period check; pause for operator approval before any delivery commit.
domain: outbound
ux_mode: approve
inputs_schema:
  type: object
  properties:
    campaign_type:
      type: string
      enum: ["newsletter", "email"]
      description: The type of campaign to draft.
    subject_hint:
      type: string
      description: Optional subject line hint or topic to anchor the draft.
    target_segment:
      type: string
      description: "Target audience segment (e.g. 'label admins', 'churned cohort', 'investor list'). Omit to draft for the default list."
    edition:
      type: string
      description: "Newsletter edition label (e.g. 'June 2026'). Required for newsletter type."
    draft_slug:
      type: string
      description: Stable slug for the newsletter/campaign (kebab-case). Used for dedup against newsletter_sends history.
    ab_variant:
      type: boolean
      default: false
      description: "If true, produce two copy variants (A/B test subjects + opening hooks)."
  required:
    - campaign_type
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft Campaign

    Draft a {{campaign_type}} campaign with the following inputs:
    - Subject hint: {{subject_hint}} (if provided)
    - Target segment: {{target_segment}} (if provided; otherwise default list)
    - Edition: {{edition}} (if provided; required for newsletter)
    - Slug: {{draft_slug}} (if provided)
    - A/B variant: {{ab_variant}}

    ## Step 1 — Context reads (host.dbQuery — SELECT-only)

    Read the following to anchor the draft:
    - `newsletter_sends` — last 5 sends for the same slug/segment (if any), for
      subject variety and open-rate context; check cooling period: if the most
      recent send was less than `settings.cooling_period_minutes` minutes ago,
      flag the cooling status prominently in the draft output.
    - `fundraising_outreach` — any prior outreach to the same segment (for
      cold/fundraising campaign_type), to avoid duplication.
    - `contacts` — segment membership count for the target_segment, for
      recipient context in the draft header.

    ## Step 2 — Draft production

    Produce the campaign draft:
    - Subject line (+ A/B variant subject if ab_variant=true)
    - Preview text (one sentence, complements subject)
    - Body copy (plain text with section breaks; Royalti voice — warm, precise,
      value-focused; no filler)
    - If ab_variant=true: produce two opening-hook variants (A + B), clearly
      labelled.
    - CTA (one primary call-to-action)
    - Unsubscribe note (required for newsletter type)

    ## Step 3 — Quality scorecard

    Score the draft on a 0–100 scale across 5 criteria (20 points each):

    | Criterion | Max | Assessment |
    |-----------|-----|------------|
    | Subject specificity | 20 | Concrete, avoids clickbait. |
    | Voice match | 20 | Matches Royalti's warm/precise editorial voice. |
    | Value clarity | 20 | Recipient benefit is stated in the first 2 sentences. |
    | CTA focus | 20 | Single, clear CTA. No competing links. |
    | Cooling compliance | 20 | No cooling violation. If cooling period not elapsed: 0. |

    Emit the scorecard in the draft output. Flag if total < quality_threshold
    (from setup config; default 75) — do NOT block the draft, but surface the
    warning prominently.

    ## Step 4 — Pause

    Present the full draft + scorecard to the operator and PAUSE (`ux_mode:
    approve`). Do NOT write anything to ikenga.db — zero writes from this action.
    The outbound pkg and `skill-outbound send` own all writes on approval.

    Cooling violation note: if the cooling period has not elapsed, surface the
    remaining minutes prominently. The operator can still approve the draft and
    schedule it for after the cooling period expires.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: draft-campaign

Draft-and-approve lifecycle for newsletter and email campaigns, following the
`06` §Pipeline-stages convention (R-04). ux_mode: approve — the draft is produced
first, then paused for operator review before any delivery commit.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` (SELECT-only):

- `newsletter_sends` — prior sends for dedup, open-rate context, and cooling
  period check.
- `fundraising_outreach` — prior cold-outreach for the same segment (dedup).
- `contacts` — segment size for recipient context.

Produces a structured campaign draft — subject, preview text, body copy, CTA,
and a quality scorecard (86/100-style) — and PAUSES (`ux_mode: approve`) for
operator review before any downstream state change.

This action produces the draft artifact; it does NOT write it. The outbound pkg
and `skill-outbound send` own all writes. Zero `ikenga.db` writes from this
action.

## Quality scorecard

The scorecard gives the operator a concrete signal before committing to send:

```
=== Campaign Quality — {{campaign_type}} · {{subject_hint}} ===

Subject specificity  : 18/20 — Specific claim, no filler
Voice match          : 16/20 — Mostly warm; tighten second paragraph
Value clarity        : 18/20 — Benefit stated in sentence 2
CTA focus            : 20/20 — One CTA, clear
Cooling compliance   : 20/20 — Last send was 3h 15m ago (cooling period: 60m)
─────────────────────────────
TOTAL                : 92/100 ✓ (threshold: 75)

=== Awaiting approval — zero writes until you confirm ===
```

If an A/B variant is requested, both variants are scored independently and
presented side by side.

## Cooling-period enforcement

The cooling period is the minimum minutes between newsletter sends to the same
list, configured during `setup` (default: 60 minutes). `draft-campaign` reads
`newsletter_sends` to determine the last send timestamp for the slug/segment:

- If the cooling period **has elapsed**: draft proceeds normally; cooling
  compliance = 20/20.
- If the cooling period **has NOT elapsed**: the draft still proceeds (ux_mode:
  approve is not blocked); cooling compliance = 0/20; a prominent warning surfaces
  showing the remaining cooling time. The operator can approve the draft and the
  `send` action will re-check the cooling status at dispatch time.

## Source inventory rows absorbed

- Newsletter campaign drafting workflows (outbound domain, R22 scope)
- Email campaign authoring (fundraising / cold-outreach email drafts)
- Quality-gate scorecard (86/100 fixture shown in `designs/atelier-outbound-newsletter.html`)
