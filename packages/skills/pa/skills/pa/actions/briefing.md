---
name: briefing
description: Compile a morning, EOD, or weekly briefing from tasks, calendar, email, and agent-run state.
domain: tasks
ux_mode: streaming
inputs_schema:
  type: object
  properties:
    kind:
      type: string
      enum: [morning, eod, weekly]
      default: morning
      description: Which briefing template to render.
    since:
      type: string
      format: date-time
      description: Look-back window start (default — last briefing timestamp or midnight).
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # PA Briefing — {{kind}}

    TODO (WP-12): Read `tasks` (pending/overdue), `calendar_events` (today/upcoming),
    `email_messages` (unread/untriaged), `agent_reports` (recent), `agent_runs`
    (last 24h status) via host.dbQuery. Render a structured briefing matching the
    {{kind}} template. Stream output to the dock.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 8 * * 1-5"
    label: Weekday morning briefing
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: briefing

> **WP-12 stub.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). The prose body — prompt detail,
> rendering rules, table queries, output format — lands in WP-12.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to aggregate:

- `tasks` — pending / overdue / completed-today counts + top-priority items
- `calendar_events` — today's schedule + next event up
- `email_messages` — untriaged / reply-now count
- `agent_reports` — most recent per-domain reports with alerts
- `agent_runs` — last 24h run status summary

Streams a structured briefing (morning / EOD / weekly) to the dock chat.
No writes. `ux_mode: streaming` — output appears live.

## Source inventory rows lifted

- `pa-briefing` skill (proposed_home: tasks, purpose: briefing templates)
- `/pa-morning` command (morning briefing — overnight emails, calendar, overdue tasks)
- `/pa-eod` command (end-of-day capture)
- `/pa-weekly` command (weekly digest)
- `pa:morning-briefing` cron (weekday 8am → absorbed as `schedule` trigger above)
