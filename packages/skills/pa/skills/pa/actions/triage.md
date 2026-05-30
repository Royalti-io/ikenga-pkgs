---
name: triage
description: Triage unhandled inbox items (email + task queue) into buckets; produce draft decisions for operator approval before any write.
domain: tasks
ux_mode: approve
inputs_schema:
  type: object
  properties:
    mode:
      type: string
      enum: [inbox, tasks, all]
      default: all
      description: Which queue to triage — email inbox, task queue, or both.
    max_items:
      type: integer
      minimum: 1
      default: 30
      description: Maximum items to triage in one pass.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # PA Triage — {{mode}}

    TODO (WP-12): Read untriaged `email_messages` (triage_category IS NULL or empty)
    and/or unassigned `tasks` (status = 'pending', assigned_to IS NULL) via
    host.dbQuery. Produce a structured triage plan (bucket assignments, delegate
    targets, archive rationale) and pause for operator approval before any downstream
    action. Do NOT write anything — triage decisions surface for approval only.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 8,12,17 * * 1-5"
    label: Weekday triage (8am / noon / 5pm)
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: triage

> **WP-12 stub.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). The prose body lands in WP-12.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery`:

- `email_messages` where `triage_category` IS NULL or blank — untriaged inbox
- `tasks` where `status = 'pending'` and `assigned_to` IS NULL — unrouted queue
- `delegations` where `status = 'assigned'` — outstanding, may need nudge
- `agent_handoffs` where `status = 'pending'` — cross-domain handoffs awaiting resolution

Produces a structured triage plan — bucket assignments (reply-now / delegate /
archive / snooze for email; assign-to / block / close for tasks) — and PAUSES
(`ux_mode: approve`) for operator review before any downstream state change.

This action produces decisions; it does NOT write them. The tasks pkg / mail pkg
own the writes. The only write skill-pa ever does is the `email_drafts.status`
transition in the `send` action.

## Source inventory rows lifted

- `pa-assistant` agent (email triage, task delegation)
- `/pa-task-triage` command (route unassigned tasks to correct agent)
- `/pa-triage` command (triage emails — single / bulk / untriaged / recheck)
- `/pa-inbox` command (inbox review — all actionable items)
- `pa:email-triage` cron (3x daily → absorbed as `schedule` trigger above)
- `pa:task-triage` cron (daily 8:30am → merged into the weekday schedule)
