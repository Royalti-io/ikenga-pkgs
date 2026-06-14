---
name: research-sweep
description: Read monitored sources and open research notes via host.dbQuery, draft stale-refresh and dossier-advance proposals with evidence; pause for operator approval before any host write.
domain: research
ux_mode: approve
inputs_schema:
  type: object
  properties:
    max_notes:
      type: integer
      minimum: 1
      default: 50
      description: Maximum number of open research notes to evaluate in one sweep.
    stale_override:
      type: object
      description: Per-stage stale threshold overrides in days. Overrides values in .atelier/skill-research/manifest.json if provided.
      properties:
        draft:
          type: integer
          minimum: 1
        review:
          type: integer
          minimum: 1
        validated:
          type: integer
          minimum: 1
      additionalProperties: false
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Research Sweep

    Read all open research notes and monitored sources from `ikenga.db` via
    host.dbQuery and produce a structured next-action proposal list for operator
    approval.

    **Base-columns-only constraint:** Query ONLY the real base columns from
    `research_notes`: `id`, `title`, `entity_type`, `entity_name`, `entity_id`,
    `summary`, `body`, `source_urls`, `research_depth`, `tags`, `fit_score`,
    `fit_notes`, `status`, `researched_by`. Do NOT reference `next_action`,
    `next_action_target`, `agent_cycle_id`, `is_stale`, `word_count`, or `owner`
    — those extended columns do not yet exist until the domain WP migration runs.

    ## Step 1 — fetch open research notes (base columns only)

    ```sql
    SELECT id, title, entity_type, entity_name, entity_id,
           summary, source_urls, research_depth, tags,
           fit_score, status, researched_by
    FROM research_notes
    WHERE status NOT IN ('archived')
    ORDER BY
      CASE status
        WHEN 'review'    THEN 1
        WHEN 'draft'     THEN 2
        WHEN 'validated' THEN 3
        ELSE 4
      END
    LIMIT {{max_notes}}
    ```

    ## Step 2 — fetch monitored sources (if research_sources table exists)

    Attempt to read the monitored sources register. If the table does not yet
    exist (pre-migration), note that sources monitoring is not yet active and
    skip to Step 3.

    When the table exists:
    ```sql
    SELECT id, name, type, cadence, status, last_checked
    FROM research_sources
    ORDER BY
      CASE status
        WHEN 'stale'  THEN 1
        WHEN 'signal' THEN 2
        WHEN 'fresh'  THEN 3
        ELSE 4
      END,
      last_checked ASC
    ```

    ## Step 3 — evaluate staleness and generate proposals

    For each research note, compute staleness against the stage thresholds from
    `.atelier/skill-research/manifest.json` (or defaults: draft=14, review=7,
    validated=30). Use the `id` column's row age as a conservative proxy (no
    stage_transitions table yet in base schema).

    Flag a note as `[STALE]` when it has exceeded its stage threshold.

    For prospect notes (`entity_type IN ('prospect', 'icp')`) where `entity_id`
    is non-null, flag for a "Hand to sales" review if `status = 'validated'`
    and the note has not already been dispatched (entity_id present, but no
    cross-domain link confirmed — determined from note context).

    For each monitored source, compute staleness from `last_checked` vs. the
    cadence. Flag `[STALE]` when past the stale threshold; flag `[SIGNAL]` when
    approaching it.

    ## Step 4 — propose next actions with ux_mode

    For each research note, draft a next-action proposal following the
    Pipeline-stages ux_mode mapping (06-skill-action-contract.md §Pipeline-stages):

    - `silent`  — agent auto-advance within a stage (e.g. research-agent drafts
                  a competitor teardown from a brief with no operator prompt)
    - `confirm` — operator one-off advance (e.g. advance draft → review after a
                  research pass; advance review → validated after verification)
    - `approve` — any outward dispatch: hand-to-sales for a prospect dossier
                  (writes cross-domain link to sales_deals via host after approval);
                  source re-scrape trigger (fires agent job after approval);
                  any action that commits beyond the local research knowledge base

    **Note on prospect dossiers (R-05/R-06 pattern):** Notes with
    `entity_type IN ('prospect', 'icp')` and `status = 'validated'` may propose
    a "Hand to sales" action. This action is always `ux_mode: approve` — the
    cross-domain commit to `sales_deals` is an outward write. The host/pane
    commits the link on approval; this skill surfaces the proposal only.

    **Note on source refresh proposals:** A stale monitored source proposal
    is always `ux_mode: approve` — it triggers a re-scrape agent job via the
    host after operator approval. Format the proposal with the source name,
    current status, days since last check, and the proposed action (re-scrape).

    Format each research note proposal as:

    ```
    NOTE:         <title>
    TYPE:         <entity_type>
    SUBJECT:      <entity_name>
    STAGE:        <status>
    OWNER:        <researched_by>
    DEPTH:        <research_depth>
    SOURCES:      <JSON.parse(source_urls).length> sources
    DAYS IN STAGE:<estimated days> [STALE if > threshold]
    EVIDENCE:     <fit_score if persona | tags | entity_id cross-domain hint>
    PROPOSED:     <next action description>
    UX_MODE:      silent | confirm | approve
    REASON:       <one-line rationale>
    ```

    Format each source proposal as:

    ```
    SOURCE:       <name>
    TYPE:         <type>
    CADENCE:      <cadence>
    STATUS:       <status> [STALE / SIGNAL as appropriate]
    LAST CHECKED: <last_checked>
    PROPOSED:     Re-scrape and update freshness status
    UX_MODE:      approve
    REASON:       Source is past its <cadence> check window
    ```

    Group proposals:
    1. STALE research notes (past threshold for their stage)
    2. STALE / SIGNAL monitored sources (re-scrape proposals)
    3. Hand-to-sales proposals (validated prospect dossiers ready for dispatch)
    4. Other active notes by stage (review → draft → validated)

    ## Step 5 — pause for approval (ux_mode: approve)

    Present the full proposal list and STOP. Do not write anything to the DB.
    Approved proposals will be dispatched through the host write path after the
    operator confirms:
    - Stage advances → host updates `research_notes.status`
    - Source refresh → host triggers re-scrape agent job
    - Hand to sales → host writes cross-domain link to `sales_deals`
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 8 * * 1-5"
    label: Weekday morning research sweep
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: research-sweep

> **WP-22a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to identify open research notes that need
attention and monitored sources that need refreshing. Produces a structured
next-action proposal list with evidence — including stale-source refresh proposals,
stage-advance proposals, and "Hand to sales" dispatch proposals for validated
prospect dossiers — then pauses for operator approval before any state change
(`ux_mode: approve` — E-11 gate). Approved proposals dispatch through the host
write path; the skill never writes to the DB.

## Base-columns-only constraint

**SQL MUST ONLY touch base columns.** The domain WP migration adds extended
columns to the research schema (`next_action`, `next_action_target`,
`agent_cycle_id`, `is_stale`, `word_count`, `owner`). Until that migration runs,
this action decouples from the migration by querying only the base columns already
present in `research_notes`.

Legal base columns: `id`, `title`, `entity_type`, `entity_name`, `entity_id`,
`summary`, `body`, `source_urls`, `research_depth`, `tags`, `fit_score`,
`fit_notes`, `status`, `researched_by`.

## Pipeline-stages convention (R-04)

The research domain stage enum:
`draft → review → validated` (terminal: `archived`)

Each proposal carries a `ux_mode` per the Pipeline-stages mapping:

| Scenario | ux_mode | Why |
|---|---|---|
| Agent auto-advance within a stage (e.g. research-agent deepens a brief) | `silent` | Intra-stage; no external commit |
| Operator one-off stage advance (draft → review, review → validated) | `confirm` | Stage boundary; operator confirms intent |
| Hand-to-sales dispatch or source re-scrape trigger | `approve` | External commit; E-11 gate required |

## Stale-note flagging (business rule)

A note is flagged `[STALE]` when it has exceeded the stale threshold for its stage.
Default thresholds (from `lib/state.md`):

| Stage | Default threshold |
|---|---|
| `draft` | 14 days |
| `review` | 7 days |
| `validated` | 30 days |

## Stale-source flagging (business rule)

A monitored source is flagged when it has exceeded its cadence-based threshold
(from `lib/state.md`):

| Cadence | Signal after | Stale after |
|---|---|---|
| `daily` | 1 day | 2 days |
| `weekly` | 5 days | 7 days |
| `monthly` | 21 days | 30 days |

## Hand-to-sales proposals (R-05/R-06 pattern)

Validated prospect dossiers (`entity_type IN ('prospect', 'icp')`,
`status = 'validated'`) may be proposed for hand-to-sales dispatch. The proposal:
- Surfaces the dossier summary and cross-domain link target in the approve gate.
- Is always `ux_mode: approve` — the cross-domain commit writes to `sales_deals`.
- Does NOT trigger the commit from the skill — the host/pane writes the link on
  operator approval.

## No direct writes (R4)

`research-sweep` is READ-ONLY. All reads are SELECT-only via `host.dbQuery`. It
produces proposals and pauses. The host commits approved proposals.

## Tables read

| Table | Columns | Purpose |
|---|---|---|
| `research_notes` | id, title, entity_type, entity_name, entity_id, summary, source_urls, research_depth, tags, fit_score, status, researched_by | Open notes — base cols only |
| `research_sources` | id, name, type, cadence, status, last_checked | Monitored source register — freshness and stale detection |

Both tables are SELECT-only via `host.dbQuery`. No writes.
