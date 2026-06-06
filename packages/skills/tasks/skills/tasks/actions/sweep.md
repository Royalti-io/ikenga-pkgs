---
name: sweep
description: Read completion-signal candidates from ikenga.db; produce draft close-decisions with evidence for operator approval.
domain: tasks
ux_mode: approve
inputs_schema:
  type: object
  properties:
    lookback_days:
      type: integer
      minimum: 1
      default: 14
      description: How many days back to scan for completion signals.
    max_candidates:
      type: integer
      minimum: 1
      default: 50
      description: Maximum number of candidate tasks to evaluate in one sweep.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Tasks Completion Sweep

    Read completion-signal candidates from `ikenga.db` via host.dbQuery and
    produce a structured draft close-decision list for operator approval.

    ## Step 1 — fetch open candidates

    ```sql
    SELECT id, title, status, priority, assigned_to, assignee_type,
           due_date, updated_at, outcome_notes, category,
           completed_at, last_checked_at
    FROM tasks
    WHERE status NOT IN ('closed', 'cancelled')
      AND (
        completed_at IS NOT NULL
        OR (status = 'done')
        OR (due_date IS NOT NULL AND due_date < date('now', '-{{lookback_days}} days')
            AND status = 'pending')
      )
    ORDER BY updated_at DESC
    LIMIT {{max_candidates}}
    ```

    ## Step 2 — gather evidence for each candidate

    For each candidate, collect corroborating evidence via host.dbQuery:

    **agent_runs evidence** — did a recent agent run complete work on this task?
    ```sql
    SELECT id, agent_name, status, output_summary, completed_at
    FROM agent_runs
    WHERE status = 'completed'
      AND completed_at >= datetime('now', '-{{lookback_days}} days')
      AND (command LIKE '%' || :task_id || '%'
           OR output_summary LIKE '%' || :title || '%')
    LIMIT 3
    ```

    **delegations evidence** — is there a completed delegation?
    ```sql
    SELECT id, delegated_to, delegate_type, status, completed_at, notes
    FROM delegations
    WHERE task_id = :task_id
      AND status IN ('completed', 'done')
    LIMIT 3
    ```

    ## Step 3 — produce close-decision draft

    For each candidate, draft a close-decision entry:

    ```
    CANDIDATE: <task title> [<id>]
    STATUS:     <current status>
    SIGNAL:     <why it looks done: completed_at set / status=done / overdue+inactive>
    EVIDENCE:   <agent_runs refs> | <delegations refs> | none
    CONFIDENCE: high / medium / low
    PROPOSED:   close (status → 'closed', completed_at = now()) | skip (needs more info)
    REASON:     <one-line rationale>
    ```

    Group decisions by confidence. High-confidence closes first.

    ## Step 4 — pause for approval (ux_mode: approve)

    Present the full decision list and STOP. Do not write anything to the DB.
    Approved closes will be dispatched through the host write path after the
    operator confirms.
triggers:
  - kind: manual
  - kind: schedule
    cron: "30 */4 * * *"
    label: Task completion sweep (every 4 hours)
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: sweep

> **WP-16 stub.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). The prose body lands in WP-16.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to identify tasks that appear to have
completed but have not yet been formally closed. Produces a structured draft
close-decision list with evidence, then pauses for operator approval before
any state change (`ux_mode: approve` — E-11 gate). Approved closes dispatch
through the host write path; the skill never writes to the DB.

## Source inventory rows lifted

- `pa:task-health` cron (absorbed as the `30 */4 * * *` schedule trigger)
- `/pa-task-triage` command (route unassigned / stale tasks — cross-queue
  triage of email+tasks stays in skill-pa; this sweep is tasks-only)

## Tables read

| Table | Columns | Purpose |
|---|---|---|
| `tasks` | id, title, status, priority, assigned_to, assignee_type, due_date, updated_at, outcome_notes, category, completed_at, last_checked_at | Candidate selection + display data |
| `agent_runs` | id, agent_name, status, output_summary, completed_at, command | Evidence: did an agent complete work referencing this task? |
| `delegations` | id, task_id, delegated_to, delegate_type, status, completed_at, notes | Evidence: is there a completed delegation for this task? |

All reads are SELECT-only via `host.dbQuery`. No writes.

## Completion signals (candidate criteria)

A task becomes a sweep candidate if any of:

1. `completed_at IS NOT NULL` — already has a completion timestamp but is not
   `closed` or `cancelled`.
2. `status = 'done'` — marked done by the tasks pkg but not yet formally closed.
3. `due_date < now - lookback_days AND status = 'pending'` — overdue and no
   recent activity (likely abandoned or blocked; surfaces for human decision).

## Decision confidence

- **High** — `completed_at` set AND corroborating agent_run or delegation
  evidence.
- **Medium** — `status = 'done'` with no additional evidence, or
  `completed_at` set with no corroboration.
- **Low** — overdue+inactive with no completion signal; operator may close,
  block, or skip.

## Operator approval gate (E-11)

`ux_mode: approve` — the action executes through step 3 (producing the draft
decision list), then PAUSES. The operator reviews, edits, or rejects entries.
Only after explicit approval do the close-transitions fire — and those are
dispatched by the host, not emitted by this skill.

## Cross-queue triage boundary

This sweep is **tasks-only**. Cross-domain triage (email + task queue together)
belongs to `skill-pa`'s `triage` action. Per the DO-NOT-TOUCH constraint, this
skill does not duplicate skill-pa's `triage`.
