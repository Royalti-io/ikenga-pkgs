---
"@ikenga/skill-pa": minor
---

Initial release of `@ikenga/skill-pa` (WP-11 + WP-12 — scaffold + dispatch actions).

Introduces the PA dispatch skill: morning briefing, inbox/task triage, and
send-queue dispatch for the personal-assistant domain. **Dispatch-only per R4**
— task and email CRUD belongs to the tasks and mail pkgs, not here.

Four actions ship with full, validated `ActionFrontmatter` frontmatter:

- `briefing` (`ux_mode: streaming`) — morning / EOD / weekly briefing compiled
  from `tasks`, `calendar_events`, `email_messages`, and `agent_reports`;
  manual + weekday-morning schedule (`0 8 * * 1-5`).
- `triage` (`ux_mode: approve`) — triage unhandled inbox items (email + task
  queue) into buckets; produces draft decisions for the operator approve/edit/
  reject gate (E-11) before any write; manual + weekday schedule.
- `send` (`ux_mode: confirm`) — surface the approved email-drafts queue and
  dispatch on operator confirmation; the one narrow `host.dbExec` status write
  is gated behind the confirm pause.
- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` lifecycle
  action; writes `${CLAUDE_PROJECT_DIR}/.atelier/skill-pa/manifest.json`.

All actions declare `depends_on: ["skill-core"]`, carry zero CRUD verbs, and
keep state on the local `ikenga.db` via `host.dbQuery` (SELECT) /
`host.dbExec` (single status write) — no Supabase, no `supabase_tables`.
Each validates against the locked `ActionFrontmatter` Zod (WP-06) and
round-trips through the WP-08 portability adapter to both a Claude tool and a
Mastra `createTool` stub (70/70 bench assertions green).

3-copy publish sync (dev source → canonical → mirror) documented in
`packages/skills/pa/PUBLISHING.md`; publish + mirror creation are the
explicit supervised follow-up (WP-14 exec, not yet run).
