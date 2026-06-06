---
name: tasks
description: |
  Tasks dispatch — roster setup and completion-sweep for the tasks domain.
  Reads `ikenga.db` via `host.dbQuery` (SELECT-only); approved close-decisions
  dispatch through the host write path. DISPATCH-ONLY: task CRUD belongs to the
  tasks pkg (`com.ikenga.tasks`), not here.

  TRIGGER when the user asks to configure the project task roster, run a
  completion sweep, or close stale/done tasks in batch.

  DO NOT TRIGGER for task CRUD (create/edit/delete/reassign). Route those to
  the tasks app pkg.
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# tasks — dispatch-only tasks surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope) is in `lib/state.md` — read it
before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` ships as `com.ikenga.skill-core` on `ikenga-pkgs` main.
> Per the G-04 contract and the lint spec in `06-skill-action-contract.md` §5,
> no other target is legal.

---

## Purpose (one line)

Produce the project roster for the tasks owner-picker and run completion sweeps
— reading `ikenga.db` state, never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure the project roster (humans + agents). Writes `.atelier/skill-tasks/roster.json` + `manifest.json`. |
| `sweep` | [`actions/sweep.md`](actions/sweep.md) | `approve` | Read completion-signal candidates from `ikenga.db`; produce draft close-decisions for operator approval. |

Both actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`. Action bodies land in WP-16.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "setup task roster", "configure skill-tasks", "who should tasks be assigned to" | [`actions/setup.md`](actions/setup.md) | `ai_infer` or `interview` mode; writes `.atelier/skill-tasks/roster.json` + `manifest.json` |
| "sweep tasks", "close done tasks", "completion sweep", "what can be closed" | [`actions/sweep.md`](actions/sweep.md) | Read `tasks` + evidence tables; produce close-decision list; pause for operator approval |

---

## What skill-tasks does NOT do

- **No task CRUD** — create/edit/delete/reassign tasks belongs to the tasks app pkg (`com.ikenga.tasks`).
- **No email CRUD** — mail records are read-only evidence for sweep decisions.
- **No cross-queue triage** — cross-domain triage (email + task queue together) stays in skill-pa; this skill owns the tasks-only sweep.
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.
- **No direct DB writes from skill** — approved close-decisions dispatch through the host write path; the skill itself does not call `host.dbExec`.

---

## Critical files

```
tasks/
├── SKILL.md                  ← you are here (router only)
├── lib/state.md              ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md              ← WP-16 body
    └── sweep.md              ← WP-16 body
```
