---
name: pa
description: |
  PA dispatch — morning briefing, inbox/task triage, and send-queue dispatch
  for the personal-assistant surface. Reads `ikenga.db` via `host.dbQuery`
  (SELECT-only); triggers approved sends via `host.dbExec`. DISPATCH-ONLY:
  task and email CRUD belongs to the tasks and mail pkgs, not here.

  TRIGGER when the user asks for a morning briefing, inbox/task triage, or
  wants to dispatch queued sends. Runs as a Chi conversation in the dock.

  DO NOT TRIGGER for task or email CRUD (create/edit/delete). Route those to
  the tasks pkg or the mail pkg.
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# pa — dispatch-only PA surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope) is in `lib/state.md` — read it
before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` is not yet packaged (Phase 3+). skill-pa declares the dependency
> edge now (per the G-04 contract and the lint spec in `06-skill-action-contract.md`
> §5) so the graph is correct from day one; the dependency resolves when skill-core
> ships. Per the lint, no other target is legal.

---

## Purpose (one line)

Dispatch morning briefing, inbox triage, task triage, and queued sends — reading
`ikenga.db` state, never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `briefing` | [`actions/briefing.md`](actions/briefing.md) | `streaming` | Compile a morning/EOD/weekly briefing from tasks, calendar, email, and agent-run state. |
| `triage` | [`actions/triage.md`](actions/triage.md) | `approve` | Triage unhandled inbox items (email + task queue) into buckets; produce draft decisions for operator approval before any write. |
| `send` | [`actions/send.md`](actions/send.md) | `confirm` | Dispatch approved items from the email-drafts queue; operator confirms the send-list before any delivery commit. |
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure skill-pa for the current project (inbox labels, triage buckets, send policy). Writes `.atelier/skill-pa/manifest.json`. |

All four actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`. Action bodies land in WP-12.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "morning briefing", "EOD summary", "weekly digest", "brief me" | [`actions/briefing.md`](actions/briefing.md) | Compile from `tasks` + `calendar_events` + `email_messages` + `agent_reports`; stream to dock |
| "triage my inbox", "triage tasks", "what needs attention" | [`actions/triage.md`](actions/triage.md) | Read `email_messages` + `tasks` + `delegations`; produce triage decisions; pause for operator approval |
| "send queue", "dispatch drafts", "send approved emails" | [`actions/send.md`](actions/send.md) | Read `email_drafts` where `status = 'approved'`; surface send-list; pause for operator approval |
| "setup PA", "configure skill-pa" | [`actions/setup.md`](actions/setup.md) | `ai_infer` or `interview` mode; writes `.atelier/skill-pa/manifest.json` |

---

## What skill-pa does NOT do

- **No task CRUD** — create/edit/delete/reassign tasks belongs to the tasks pkg.
- **No email CRUD** — create/edit/delete email records belongs to the mail pkg.
- **No calendar writes** — calendar_events are read-only from this skill.
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.
- **No direct network calls** — send dispatch commits a DB state change; the
  actual delivery system is downstream of that (out of scope for this skill).

---

## Critical files

```
pa/
├── SKILL.md                  ← you are here (router only)
├── lib/state.md              ← table-scope contract + read/write boundary
├── actions/
│   ├── briefing.md           ← WP-12 body
│   ├── triage.md             ← WP-12 body
│   ├── send.md               ← WP-12 body
│   └── setup.md              ← WP-12 body
└── agents/
    └── pa-dispatcher.md      ← WP-12 agent brief
```
