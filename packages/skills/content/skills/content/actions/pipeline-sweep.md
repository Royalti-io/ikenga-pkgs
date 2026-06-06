---
name: pipeline-sweep
description: Read open content pieces via host.dbQuery (pre-0047 base columns only), draft next-action proposals with evidence, flag stale pieces; pause for operator approval before any host write.
domain: content
ux_mode: approve
inputs_schema:
  type: object
  properties:
    max_pieces:
      type: integer
      minimum: 1
      default: 50
      description: Maximum number of open content pieces to evaluate in one sweep.
    stale_override:
      type: object
      description: Per-stage stale threshold overrides in days. Overrides values in .atelier/skill-content/manifest.json if provided.
      properties:
        idea:
          type: integer
          minimum: 1
        outline:
          type: integer
          minimum: 1
        draft:
          type: integer
          minimum: 1
        review:
          type: integer
          minimum: 1
        scheduled_overdue:
          type: integer
          minimum: 1
      additionalProperties: false
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Content Pipeline Sweep

    Read all open content pieces from `ikenga.db` via host.dbQuery and produce a
    structured next-action proposal list for operator approval.

    **Base-columns-only constraint (Mock contract 3):** Query ONLY pre-0047
    columns from `content_calendar`: `id`, `type`, `channel`, `platform`,
    `title`, `slug`, `status`, `assigned_to`, `publish_date`, `publish_time`,
    `actual_publish_date`, `campaign`, `created_at`. Do NOT reference
    `next_action`, `next_action_mode`, `series_name`, `series_part`, or any
    column not in this list — those columns do not yet exist until the WP-21b
    migration runs.

    ## Step 1 — fetch open pieces (base columns only)

    ```sql
    SELECT id, type, channel, platform, title, slug,
           status, assigned_to, publish_date, publish_time,
           campaign, created_at
    FROM content_calendar
    WHERE status NOT IN ('published')
    ORDER BY publish_date ASC NULLS LAST
    LIMIT {{max_pieces}}
    ```

    ## Step 2 — gather evidence for each piece

    For each piece, collect corroborating evidence via host.dbQuery:

    **Days in current stage** — approximate from created_at when no
    content_stage_transitions table exists (pre-0047):
    Compute days_in_stage = days since `created_at` as a conservative proxy.
    Flag as stale per the per-stage thresholds (from .atelier/skill-content/manifest.json
    or defaults: idea=14, outline=14, draft=7, review=7).

    For `scheduled` pieces: check if `publish_date` is in the past and
    `actual_publish_date` is NULL → flag as overdue (threshold: 3 days past
    `publish_date`).

    **Social queue evidence** — for pieces of type `social`, check the queue:
    ```sql
    SELECT id, platform, status, scheduled_for, approved_at, approved_by
    FROM social_queue
    WHERE status NOT IN ('posted')
    ORDER BY scheduled_for ASC
    LIMIT 5
    ```

    **Calendar context** — for publish_date-bearing pieces, check nearby events:
    ```sql
    SELECT title, start_time, end_time
    FROM calendar_events
    WHERE date(start_time) BETWEEN date('now', '-3 days') AND date('now', '+14 days')
    ORDER BY start_time ASC
    LIMIT 10
    ```

    ## Step 3 — propose next actions with ux_mode

    For each piece, draft a next-action proposal following the Pipeline-stages
    ux_mode mapping (06-skill-action-contract.md §Pipeline-stages):

    - `silent`  — agent auto-advance within a stage (e.g. blog-writer drafts
                  an outline from the idea brief with no operator prompt)
    - `confirm` — operator one-off advance (e.g. move outline → draft after
                  confirming scope; move draft → review after a writing pass)
    - `approve` — any advance to `scheduled` (outward scheduling commit) or
                  any social/newsletter piece that triggers a publish pipeline;
                  also for pieces where the proposed action dispatches outward
                  (e.g. confirm newsletter send date with Listmonk)

    **Note on video pieces:** Video pieces (`type = 'video'`) are tracked only.
    Propose stage advances for video in the same format as other types, but mark
    with note "VIDEO TRACKING ONLY — production belongs to com.ikenga.studio".
    Do NOT propose any Remotion job, encoding step, or publish action for video.

    **Note on social pieces:** Social posts with `channel IN ('LinkedIn', 'X')`
    that need to advance to `scheduled` always require `ux_mode: approve` — the
    scheduling commit is an outward dispatch. The `skill-outbound` skill owns the
    actual send; this skill surfaces the proposal.

    Format each proposal as:

    ```
    PIECE:        <title>
    TYPE:         <type> [VIDEO TRACKING ONLY if type=video]
    CHANNEL:      <channel>
    STAGE:        <current status>
    OWNER:        <assigned_to>
    PUBLISH DATE: <publish_date or TBD>
    DAYS IN STAGE:<days_in_stage>d [STALE if > threshold]
    EVIDENCE:     <social queue status | calendar context | campaign group>
    PROPOSED:     <next action description>
    UX_MODE:      silent | confirm | approve
    REASON:       <one-line rationale>
    ```

    Group proposals: STALE pieces first (past threshold for their stage), then
    OVERDUE scheduled pieces, then by stage
    (review → draft → outline → idea).

    If `assigned_to` is an agent slug (`blog-writer`, `content-agent`,
    `cmo-agent`, `social-agent`) and the proposed action is intra-stage and
    low-risk, prefer `ux_mode: silent`. Any advance to `scheduled` or any
    outward-dispatching action is always `ux_mode: approve`.

    ## Step 4 — pause for approval (ux_mode: approve)

    Present the full proposal list and STOP. Do not write anything to the DB.
    Approved stage-advances will be dispatched through the host write path after
    the operator confirms.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 9 * * 1-5"
    label: Weekday morning content pipeline sweep
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: pipeline-sweep

> **WP-21a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to identify open content pieces that need
attention: stale pieces (stuck past their stage threshold), overdue scheduled
pieces, and pieces where an agent has a pending action. Produces a structured
next-action proposal list with evidence, then pauses for operator approval before
any state change (`ux_mode: approve` — E-11 gate). Approved advances dispatch
through the host write path; the skill never writes to the DB.

## Base-columns-only constraint (Mock contract 3)

**SQL MUST ONLY touch pre-0047 columns.** The WP-21b migration (migration 0047)
adds app-layer columns to the content schema. Until that migration runs, this
action decouples from WP-21b by querying only the base columns already present
in `content_calendar`:

```
content_calendar: id, type, channel, platform, title, slug, status,
                  assigned_to, publish_date, publish_time, actual_publish_date,
                  campaign, created_at
```

Grep evidence (DoD check): no post-0047 column (`next_action`, `next_action_mode`,
`series_name`, `series_part`) appears in any SQL in this file's run.prompt above.

## Pipeline-stages convention (R-04)

The content domain stage enum:
`idea → outline → draft → review → scheduled` (terminal: `published`)

Each proposal carries a `ux_mode` per the Pipeline-stages mapping:

| Scenario | ux_mode | Why |
|---|---|---|
| Agent auto-advance within a stage (e.g. blog-writer drafts from idea brief) | `silent` | Intra-stage; no external commit |
| Operator one-off stage advance (outline → draft, draft → review) | `confirm` | Stage boundary; operator confirms intent |
| Advance to `scheduled` or any outward dispatch | `approve` | Publishing commit; E-11 gate required |
| Social post or newsletter triggering send pipeline | `approve` | External dispatch via skill-outbound |

The stage enum is resolved from `.atelier/skill-content/manifest.json` (written
by `setup`). If the manifest is absent, use the default enum above.

## Stale-piece flagging (business rule)

A piece is flagged `[STALE]` when `days_in_stage > stale_threshold` for its stage.
Default thresholds (from `lib/state.md`):

| Stage | Default threshold |
|---|---|
| `idea` | 14 days |
| `outline` | 14 days |
| `draft` | 7 days |
| `review` | 7 days |
| `scheduled` overdue | 3 days past `publish_date` |

Source: `created_at` as a conservative proxy (pre-0047; no `content_stage_transitions`
table exists yet). When WP-21b's migration runs and a stage-transitions table is
added, a future version of this action can switch to transition-based `days_in_stage`.

## Video pieces — tracking only (G-VIDEO-STACK, R23)

Video pieces (`type = 'video'`) appear in sweep proposals as tracking entries.
The action surfaces their stage and staleness, but:

- Proposes NO Remotion jobs, FFmpeg encodes, or YouTube/Vimeo uploads.
- Does NOT reference `com.ikenga.studio` tooling in the proposal body.
- Marks every video proposal with "VIDEO TRACKING ONLY" to distinguish from
  actionable content types.

Video production belongs to `com.ikenga.studio` (G-VIDEO-STACK, R23).

## No publish/send transport (R22)

When proposing a social post or newsletter to move to `scheduled`, the proposal
surfaces the intent but does NOT trigger the send. The scheduling + send dispatch
belongs to `skill-outbound` (R22). This skill proposes; the operator approves;
the host routes to the appropriate send pathway.

## Operator approval gate (E-11)

`ux_mode: approve` — the action executes through step 3 (producing the draft
proposal list), then PAUSES. The operator reviews, edits, or rejects proposals.
Only after explicit approval do the stage-advance writes fire — and those are
dispatched by the host, not emitted by this skill.

## Schedule trigger

Absorbed as a `0 9 * * 1-5` schedule trigger (weekday mornings at 09:00),
replacing any legacy content-review cron. Also available as a manual trigger
for on-demand reviews.

## Tables read

| Table | Columns (pre-0047 base only for content_calendar) | Purpose |
|---|---|---|
| `content_calendar` | id, type, channel, platform, title, slug, status, assigned_to, publish_date, publish_time, actual_publish_date, campaign, created_at | Open piece list — base cols only |
| `social_queue` | id, platform, status, scheduled_for, approved_at, approved_by | Social queue state for social-type piece evidence |
| `calendar_events` | title, start_time, end_time | Nearby events for publish-date context |

All reads are SELECT-only via `host.dbQuery`. No writes.
