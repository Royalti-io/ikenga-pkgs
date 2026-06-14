---
name: strategy-review
description: Run the weekly/cycle OKR review — read open objectives and KR state via host.dbQuery, draft countersign proposals with evidence, flag at-risk objectives; pause for operator approval before any host write.
domain: strategy
ux_mode: approve
inputs_schema:
  type: object
  properties:
    cycle:
      type: string
      description: "The planning cycle to review (e.g. 'Q2 2026'). Defaults to active_cycle from .atelier/skill-strategy/manifest.json."
    max_objectives:
      type: integer
      minimum: 1
      default: 20
      description: Maximum number of open objectives to evaluate in one review.
    at_risk_override:
      type: object
      description: Per-threshold at-risk overrides. Overrides values in .atelier/skill-strategy/manifest.json if provided.
      properties:
        pct:
          type: integer
          minimum: 1
          maximum: 100
        days_elapsed:
          type: integer
          minimum: 1
      additionalProperties: false
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Strategy OKR Review

    Read all open objectives from `ikenga.db` via host.dbQuery and produce a
    structured countersign proposal list for operator approval.

    **Graceful degradation:** If `strategy_objectives` / `strategy_key_results` /
    `strategy_cycles` do not yet exist (schema TBD — they are created by the
    domain WP on first launch), fall back to `strategic_initiatives` for the
    objectives sweep and `review_items` (content_type = 'strategy') for the
    review log. Note the degraded mode in the review header.

    ## Step 1 — resolve active cycle

    Load `.atelier/skill-strategy/manifest.json` (if present) to read
    `active_cycle`. If absent, infer the current quarter from today's date.
    Cycle to review: {{cycle}} (or manifest default if not supplied).

    ## Step 2 — fetch open objectives

    **If `strategy_objectives` exists:**
    ```sql
    SELECT id, title, area, cycle_id, overall_pct, owner, ux_mode, next_action, created_at
    FROM strategy_objectives
    WHERE cycle_id = (SELECT id FROM strategy_cycles WHERE name = ? ORDER BY start_date DESC LIMIT 1)
    ORDER BY overall_pct ASC
    LIMIT {{max_objectives}}
    ```

    **Fallback (strategic_initiatives):**
    ```sql
    SELECT id, name AS title, ties_to_goal AS area, quarter AS cycle_id,
           NULL AS overall_pct, owner_agent AS owner,
           NULL AS ux_mode, NULL AS next_action, NULL AS created_at
    FROM strategic_initiatives
    WHERE quarter = ?
      AND status NOT IN ('closed', 'cancelled')
    ORDER BY name ASC
    LIMIT {{max_objectives}}
    ```

    ## Step 3 — gather evidence for each objective

    For each objective, collect corroborating evidence via host.dbQuery:

    **KR progress (if strategy_key_results exists):**
    ```sql
    SELECT id, label, pct, is_low, is_mid
    FROM strategy_key_results
    WHERE objective_id = ?
    ORDER BY pct ASC
    ```

    **RICE proxy evidence (for product-area objectives):**
    ```sql
    SELECT feature_id, rice_score, score_date
    FROM feature_score_history
    ORDER BY score_date DESC
    LIMIT 5
    ```

    **Architecture decisions (for product/technical objectives):**
    ```sql
    SELECT id, title, status, decision_date, area
    FROM architecture_decisions
    WHERE status NOT IN ('superseded')
    ORDER BY decision_date DESC
    LIMIT 5
    ```

    **Backlog alignment (at-risk signal):**
    ```sql
    SELECT id, short_id, title, alignment_score, priority
    FROM ideas_backlog
    WHERE alignment_score < 50
      AND status NOT IN ('rejected', 'archived')
    ORDER BY alignment_score ASC
    LIMIT 5
    ```

    **Review log:**
    ```sql
    SELECT id, title, status, reviewed_at, review_notes, priority
    FROM review_items
    WHERE content_type = 'strategy'
    ORDER BY reviewed_at DESC NULLS LAST
    LIMIT 10
    ```

    ## Step 4 — propose next actions with ux_mode

    For each objective, draft a next-action proposal following the strategy
    ux-mode map (lib/state.md §Strategy ux-mode map):

    - `silent`  — agent acts autonomously (nightly metric sync, auto-refresh).
                  No operator button is shown. Note the scheduled action as a
                  read-only label.
    - `confirm` — operator must confirm before the agent proceeds. Present
                  "Confirm & run" in the proposal; the agent waits for the gate.
    - `approve` — operator must countersign before any outward commit fires
                  (E-11 gate). Present "Approve & run" with `.btn.affirmative`
                  styling note. Used for: seed-round SAFE signatures, GA
                  checklists, or any action that dispatches outside the shell.

    **At-risk flagging:** Flag an objective `[AT RISK]` when:
    - `overall_pct` (or KR average) < at_risk_threshold_pct (default 50) AND
    - days elapsed in the current cycle > at_risk_threshold_days_elapsed (default 30).
    If manifest thresholds are absent, use the defaults above.
    Override with `at_risk_override` input if provided.

    Format each proposal as:

    ```
    OBJECTIVE:    <title>
    AREA:         <area>
    CYCLE:        <cycle_id>
    OWNER:        <owner>
    PROGRESS:     <overall_pct>% [AT RISK if below threshold]
    KEY RESULTS:  <kr label: pct% [LOW/MID if flagged]> (one line per KR, or 'KR data unavailable' in fallback mode)
    EVIDENCE:     <RICE proxy | ADR context | alignment score | review log entry>
    NEXT ACTION:  <action description>
    UX_MODE:      silent | confirm | approve
    REASON:       <one-line rationale>
    ```

    Group proposals: AT RISK objectives first (by progress ASC), then `approve`
    mode, then `confirm` mode, then `silent` mode.

    ## Step 5 — pause for approval (ux_mode: approve)

    Present the full proposal list and STOP. Do not write anything to the DB.
    Approved countersign actions will be dispatched through the host write path
    after the operator confirms.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 9 * * 1"
    label: Weekly Monday morning OKR review
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: strategy-review

> **WP-23a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to surface open objectives that need
operator attention: at-risk objectives (below progress threshold), pending
countersign items, and scheduled agent actions. Produces a structured
next-action proposal list with evidence, then pauses for operator approval
before any state change (`ux_mode: approve` — E-11 gate). Approved actions
dispatch through the host write path; the skill never writes to the DB.

This is the skill-layer companion to the strategy screen's **"Approve & run" /
"Confirm & run" buttons** in list-mode `.pl-next` (strategy screen doc §3 —
"Confirm / Approve next action").

## Strategy ux-mode map (from strategy.md O-01..O-08 fixture)

| ux_mode | Fixture examples | When |
|---|---|---|
| `silent` | O-04 (cmo-agent forecast refresh), O-07 (cfo-agent nightly reconcile) | Agent acts autonomously; operator not required |
| `confirm` | O-01 (review weekly metric), O-03 (draft outreach), O-05 (lock designs), O-08 (resolve txns) | Operator must confirm before agent proceeds |
| `approve` | O-02 (countersign SAFE), O-06 (approve DDEX GA checklist) | Operator must countersign before external commit fires |

The `approve` gate (E-11) is mandatory for actions that commit outside the
shell: legal document signatures (O-02), GA pipeline triggers (O-06), or any
third-party dispatch. Proposals with `ux_mode: approve` pause the entire review
— the operator addresses them before the host dispatches.

## Graceful degradation (schema-TBD tables)

Until the domain WP creates `strategy_objectives`, `strategy_key_results`, and
`strategy_cycles`, this action falls back to:

- **Objectives sweep:** `strategic_initiatives` (existing) filtered by `quarter`
  matching the active cycle. `ux_mode` is derived from `status` heuristics
  (active + owner_agent = infer confirm; fallback ux_mode = confirm for all).
- **Review log:** `review_items` (existing) with `content_type = 'strategy'`.
- **KR progress:** Not available — the proposal notes "KR data unavailable;
  objective-level tracking only until strategy_key_results is created."

The degraded mode is clearly labelled in the proposal header so the operator
knows the review is running on existing tables only.

## Operator approval gate (E-11)

`ux_mode: approve` — the action executes through step 4 (producing the draft
proposal list), then PAUSES. The operator reviews, edits, or rejects proposals.
Only after explicit approval do the countersign writes fire — and those are
dispatched by the host, not emitted by this skill.

`approve` proposals (O-02, O-06 pattern): the host routes to the appropriate
external dispatch (e.g. sign SAFE via legal integration, trigger DDEX GA
pipeline). The skill surfaces the proposal; the host commits the action.

## At-risk flagging (business rules)

An objective is flagged `[AT RISK]` when both conditions hold:
1. `overall_pct < at_risk_threshold_pct` (default 50 from manifest or input)
2. Days elapsed in the current cycle > `at_risk_threshold_days_elapsed` (default 30)

This mirrors the strategy screen's "At risk" sidebar filter (count 2 in the
fixture: O-03 at 33%, O-07 at 47% — both below 50% with > 30 days elapsed).

## Schedule trigger

Absorbed as a `0 9 * * 1` schedule trigger (Monday mornings at 09:00 — weekly
OKR review cadence). Also available as a manual trigger for on-demand reviews
(e.g. mid-cycle check-ins, board update preparation).

## Tables read

| Table | Columns | Purpose |
|---|---|---|
| `strategic_initiatives` | id, name, quarter, status, owner_agent, ties_to_goal | Objectives fallback when strategy_objectives absent |
| `architecture_decisions` | id, title, status, decision_date, area | Product/technical context for strategy proposals |
| `ideas_backlog` | id, short_id, title, alignment_score, priority, status | At-risk backlog signal |
| `feature_score_history` | feature_id, rice_score, score_date | RICE proxy for product-area KR progress |
| `review_items` | id, title, status, reviewed_at, review_notes, priority, content_type | Review log (strategy filter) |
| `strategy_objectives` | id, title, area, cycle_id, overall_pct, owner, ux_mode, next_action | Primary objectives (when available) |
| `strategy_key_results` | id, objective_id, label, pct, is_low, is_mid | Per-objective KR rows (when available) |
| `strategy_cycles` | id, name, start_date, end_date, status | Cycle context (when available) |

All reads are SELECT-only via `host.dbQuery`. No writes.
