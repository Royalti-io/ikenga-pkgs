---
name: pipeline-sweep
description: Read open deals via host.dbQuery (pre-0043 base columns only), draft next-action proposals with evidence, flag deals stuck >30 days in stage; pause for operator approval before any host write.
domain: sales
ux_mode: approve
inputs_schema:
  type: object
  properties:
    max_deals:
      type: integer
      minimum: 1
      default: 50
      description: Maximum number of open deals to evaluate in one sweep.
    stale_threshold_days:
      type: integer
      minimum: 1
      default: 30
      description: Days in current stage before a deal is flagged as stale. Overrides the value in .atelier/skill-sales/manifest.json if provided.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Sales Pipeline Sweep

    Read all open deals from `ikenga.db` via host.dbQuery and produce a
    structured next-action proposal list for operator approval.

    **Base-columns-only constraint (Mock contract 2):** Query ONLY pre-0043
    columns: `id`, `company`, `contact_name`, `stage`, `value`, `score`,
    `last_contact`, `assigned_to`. Do NOT reference `title`, `owner`,
    `next_action`, `next_action_mode`, `win_probability`, or `age_days` —
    those columns do not yet exist until the WP-18b migration runs.

    ## Step 1 — fetch open deals (base columns only)

    ```sql
    SELECT id, company, contact_name, stage, value, score,
           last_contact, assigned_to
    FROM sales_deals
    WHERE stage NOT IN ('won', 'lost')
    ORDER BY last_contact ASC
    LIMIT {{max_deals}}
    ```

    ## Step 2 — gather evidence for each deal

    For each deal, collect corroborating evidence via host.dbQuery:

    **Days in stage** — from sales_stage_transitions:
    ```sql
    SELECT from_stage, to_stage, transitioned_at
    FROM sales_stage_transitions
    WHERE entity_id = :deal_id
    ORDER BY transitioned_at DESC
    LIMIT 1
    ```
    Compute days_in_stage = days since `transitioned_at` (or since the deal was
    last touched if no transition row exists). Flag as stale if
    `days_in_stage > {{stale_threshold_days}}` (default: 30).

    **Recent activity** — last touch from sales_activities:
    ```sql
    SELECT activity_type, title, activity_date
    FROM sales_activities
    WHERE deal_id = :deal_id
    ORDER BY activity_date DESC
    LIMIT 2
    ```

    **Lead score** — from sales_lead_scores (most recent row):
    ```sql
    SELECT total_score, priority, score_date
    FROM sales_lead_scores
    WHERE company_name = :company
    ORDER BY score_date DESC
    LIMIT 1
    ```

    ## Step 3 — propose next actions with ux_mode

    For each deal, draft a next-action proposal following the Pipeline-stages
    ux_mode mapping (06-skill-action-contract.md §Pipeline-stages):

    - `silent`  — agent auto-advance within a stage (e.g. send a follow-up
                  email via sales-agent with no operator prompt)
    - `confirm` — operator one-off advance (e.g. move qualified → proposal after
                  a scheduled call)
    - `approve` — terminal-crossing advance (closing → won | lost) or any
                  outward dispatch that commits an external action

    Format each proposal as:

    ```
    DEAL:         <company> — <contact_name>
    STAGE:        <current stage>
    VALUE:        <value>
    SCORE:        <score>
    LAST TOUCH:   <last_contact> (<days since last touch>d ago)
    DAYS IN STAGE:<days_in_stage>d [STALE if > stale_threshold_days]
    EVIDENCE:     <recent activities | lead score | transition history>
    PROPOSED:     <next action description>
    UX_MODE:      silent | confirm | approve
    REASON:       <one-line rationale>
    ```

    Group proposals: STALE deals first (>30d in stage), then by stage
    (closing → negotiation → proposal → qualified → lead).

    If `assigned_to = 'sales-agent'` and the proposed action is intra-stage
    and low-risk, prefer `ux_mode: silent`. Any advance TO `won` or `lost`
    is always `ux_mode: approve`.

    ## Step 4 — pause for approval (ux_mode: approve)

    Present the full proposal list and STOP. Do not write anything to the DB.
    Approved stage-advances will be dispatched through the host write path after
    the operator confirms.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 8 * * 1-5"
    label: Weekday morning pipeline sweep
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: pipeline-sweep

> **WP-18a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to identify open deals that need attention:
stale deals (stuck > 30 days in their current stage), deals with qualified signals
ready for stage advance, and deals where `sales-agent` has a pending action. Produces
a structured next-action proposal list with evidence, then pauses for operator
approval before any state change (`ux_mode: approve` — E-11 gate). Approved advances
dispatch through the host write path; the skill never writes to the DB.

## Base-columns-only constraint (Mock contract 2)

**SQL MUST ONLY touch pre-0043 columns.** The WP-18b migration (migration 0043)
adds app-layer columns to `sales_deals` (`title`, `owner`, `next_action`,
`next_action_mode`, `win_probability`, `age_days`). Until that migration runs,
those columns do not exist. This action decouples from WP-18b by querying only
the base columns that are already present:

```
sales_deals: id, company, contact_name, stage, value, score, last_contact, assigned_to
```

Grep evidence (DoD check): no column from the post-0043 list appears in any SQL
in this file's run.prompt above.

## Pipeline-stages convention (R-04)

Each proposal carries a `ux_mode` per the Pipeline-stages mapping:

| Scenario | ux_mode | Why |
|---|---|---|
| Agent auto-move within a stage (e.g. schedule a follow-up call) | `silent` | Intra-stage; no terminal crossing; no outward commit |
| Operator one-off stage advance (qualified → proposal after a call) | `confirm` | Stage boundary crossed; operator confirms intent |
| Terminal advance (any stage → won or lost) | `approve` | Terminal crossing; irreversible; high business impact |
| Outward dispatch (send MSA, fire contract) | `approve` | External commit; E-11 gate required |

The stage enum is resolved from `.atelier/skill-sales/manifest.json` (written by
`setup`). If the manifest is absent, use the default enum:
`lead → qualified → proposal → negotiation → closing → won | lost`.

## Stale-deal flagging (business rule)

A deal is flagged `[STALE]` when `days_in_stage > stale_threshold_days`
(default 30, from the instance manifest or the `stale_threshold_days` input).

Source: `sales stage_transitions.transitioned_at` for the most recent
transition to the current stage. If no transition row exists, fall back to
`sales_deals.last_contact` as the entry proxy.

Business rule origin: `plans/atelier-design-system/parts/screens/sales.md` §1
Business rules — `.split-row-when.is-urgent` renders in `--danger` when
`age_days > 30` (D-07 at 34d, D-08 at 41d in fixture).

## Operator approval gate (E-11)

`ux_mode: approve` — the action executes through step 3 (producing the draft
proposal list), then PAUSES. The operator reviews, edits, or rejects proposals.
Only after explicit approval do the stage-advance writes fire — and those are
dispatched by the host, not emitted by this skill.

## Schedule trigger

Absorbed as a `0 8 * * 1-5` schedule trigger (weekday morning), replacing the
legacy `pa:sales-sweep` cron. Also available as a manual trigger for on-demand
reviews.

## Tables read

| Table | Columns (pre-0043 base only for sales_deals) | Purpose |
|---|---|---|
| `sales_deals` | id, company, contact_name, stage, value, score, last_contact, assigned_to | Open deal list — base cols only |
| `sales_stage_transitions` | entity_id, from_stage, to_stage, transitioned_at | Days-in-stage calculation; staleness evidence |
| `sales_activities` | deal_id, activity_type, title, activity_date | Recent touch evidence |
| `sales_lead_scores` | company_name, total_score, priority, score_date | Score signal for qualification proposals |

All reads are SELECT-only via `host.dbQuery`. No writes.
