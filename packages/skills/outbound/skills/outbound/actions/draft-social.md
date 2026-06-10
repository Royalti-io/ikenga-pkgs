---
name: draft-social
description: Draft social_queue post candidates for operator confirmation before the outbound pkg inserts the row. Zero writes from the skill.
domain: outbound
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    platform:
      type: string
      enum: ["linkedin", "x", "buffer"]
      description: "Target social platform."
    topic:
      type: string
      description: "Topic or angle for the post (e.g. 'catalog import milestone', 'new tenant announcement')."
    source_content:
      type: string
      description: "Optional reference content to anchor the post (e.g. a newsletter slug, a deal milestone, a blog URL)."
    scheduled_for:
      type: string
      format: date-time
      description: "Optional: target publish timestamp. If omitted, suggest a time based on platform best-practice and social_queue schedule gaps."
    account:
      type: string
      description: "Optional: specific account handle to post from (defaults to the primary connected account for the platform)."
    thread:
      type: boolean
      default: false
      description: "If true (X only), produce a thread (up to 7 posts) rather than a single post."
  required:
    - platform
    - topic
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft Social Post

    Draft a {{platform}} post on the topic: "{{topic}}".
    Source content: {{source_content}} (if provided)
    Target time: {{scheduled_for}} (if provided; otherwise suggest)
    Account: {{account}} (if provided)
    Thread: {{thread}} (X only — if true, produce up to 7-post thread)

    ## Step 1 — Context reads (host.dbQuery — SELECT-only)

    Read the following to inform the draft:
    - `social_queue` WHERE platform = '{{platform}}' AND status IN ('scheduled','posted')
      ORDER BY scheduled_for DESC LIMIT 5: recent posts on this platform, to avoid
      topic repetition and suggest a schedule gap.
    - `contacts` (if source_content references a contact/deal): for any named
      individuals in the post.

    ## Step 2 — Draft production

    Produce the post draft:
    - **LinkedIn**: professional, narrative-driven, 150–300 words. First line is
      the hook (no "I'm excited to share" openers). Max 5 hashtags, placed at end.
    - **X**: 240 chars max per post (leave buffer for URL). If thread=true, produce
      up to 7 posts numbered 1/7..7/7; first post is the standalone hook.
    - **Buffer**: follow the platform-specific rules above (Buffer is a scheduler;
      the platform is LinkedIn, X, or both).

    If scheduled_for is not provided, suggest a schedule time based on:
    - Platform best-practice windows (LinkedIn: Tue–Thu 8–10am / noon; X: 9am / 4pm)
    - social_queue schedule gaps (avoid clustering posts within 4h of existing ones)

    ## Step 3 — Confirm

    Present the draft(s) + proposed schedule time to the operator and confirm
    (`ux_mode: confirm` — this is a pre-execution intent gate, not a post-execution
    draft review). On operator yes: return the confirmed draft as a structured
    artifact. Do NOT write to ikenga.db — the outbound pkg inserts the
    `social_queue` row on the confirmed artifact.

    Stamp the structured fields the derive layer reads on the confirmed artifact:
    `item.media_url` (the public image URL, or null for text-only) and
    `item.hashtags` (array of `'#tag'` strings, or null when none — the same tags
    that ride the content's `---hashtags---` / firstComment conventions). If a
    social draft carries factual claims, also stamp `item.quality` per the
    G-QUALITY shape documented in the outbound pkg's `dist/lib/derive.js`.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: draft-social

Confirm-before-execution lifecycle for social post candidates, following the
`06` §Pipeline-stages convention (ux_mode: confirm — this gates on intent before
execution, not after a draft is produced; appropriate because social posts are
short-form and the operator is confirming the planned insert, not reviewing a
long artifact). The ux_mode distinction matters:

- `confirm` (this action): preview the planned effect (draft + schedule), single
  yes/no, then return the artifact. The outbound pkg inserts the `social_queue`
  row.
- `approve` (draft-campaign, draft-sequence): run-then-pause on a produced
  long-form draft artifact. The artifact is substantial enough to review before
  committing.

Social posts use `confirm` because: (a) the draft is short enough to preview in
the confirm prompt itself, and (b) the insert is performed by the outbound pkg
(not this skill), so there is no lengthy draft artifact to gate on separately.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` (SELECT-only):

- `social_queue` — recent posts on the platform, for dedup and schedule-gap check.
- `contacts` — personalisation context for named individuals (optional).

Produces a social post draft (or thread, for X), proposes a schedule time, and
CONFIRMS (`ux_mode: confirm`) with the operator. On confirmation, returns the
structured artifact; the outbound pkg inserts the `social_queue` row.

This action produces the draft artifact; it does NOT write it. Zero `ikenga.db`
writes from this action.

## Platform rules

| Platform | Format | Hashtags | Length |
|----------|--------|----------|--------|
| LinkedIn | Narrative, professional | ≤5, at end | 150–300 words |
| X | Punchy, hook-first | ≤3, woven in | ≤240 chars/post; ≤7 posts for thread |
| Buffer | Follows per-platform rules above | — | — |

## Schedule suggestion algorithm

When `scheduled_for` is not provided:
1. Query `social_queue` for the next 3 days of scheduled posts on the same platform.
2. Find the first 4-hour gap in the schedule that falls within a best-practice
   window (LinkedIn: 8–10am or noon; X: 9am or 4pm), in the operator's configured
   timezone.
3. Propose that time as the suggested schedule.
4. Operator can override in the confirm prompt.

## Source inventory rows absorbed

- Social post scheduling workflows (C-07 LinkedIn seed announcement, C-08 X
  thread 7 posts — fixtures in `designs/atelier-outbound-social.html`)
- Buffer-scheduled post workflows
