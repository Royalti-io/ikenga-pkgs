---
name: query
description: |
  Cross-domain natural-language query — translate a question into parameterised
  SELECTs over ikenga.db and stream the answer. READ-ONLY: no INSERT, UPDATE,
  DELETE, or DROP is ever issued. One action: `query`.

  TRIGGER when the operator asks a question about data across any Ikenga domain
  (tasks, mail, sales, finance, content, research, strategy, agents, contacts).
  Runs as a Chi conversation in the dock, streaming the answer live.

  DO NOT TRIGGER for task/email/deal CRUD, briefing/digest generation, or any
  dispatch action. Those belong to the domain pkgs and skill-pa respectively.
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# query — cross-domain reader skill

**This file is a router.** The single action lives in `actions/query.md`.
The state contract (which `ikenga.db` tables are readable, SELECT-only boundary)
is in `lib/state.md` — read it before authoring or modifying the action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` is not yet packaged (Phase 3+). skill-query declares the
> dependency edge now (per the G-04 contract and the lint spec in
> `06-skill-action-contract.md` §5) so the graph is correct from day one; the
> dependency resolves when skill-core ships. Per the lint, no other target is
> legal.

---

## Purpose (one line)

Translate operator questions into parameterised SELECTs over `ikenga.db` and
stream the answer — reading all declared domain tables, writing nothing.

---

## Actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `query` | [`actions/query.md`](actions/query.md) | `streaming` | Translate a natural-language question into SQL SELECTs; stream the formatted answer. |

No `setup` action — skill-query has no per-project instance state. It reads; it
does not configure. No digest/report action — recurring briefings stay with
`skill-pa briefing` (P5 dedup).

---

## Routing

| If the operator asks… | Load | Then |
|---|---|---|
| Any question about data: "how many tasks…", "show me deals…", "what revenue…", "which content…" | [`actions/query.md`](actions/query.md) | Translate → parameterised SELECT → stream answer |

**Do not route here** for:
- Task/email/deal create, edit, delete, reassign → domain pkgs
- Morning briefing, EOD summary, weekly digest → `skill-pa briefing`
- Dispatching sends, approving drafts → domain pkgs

---

## What skill-query does NOT do

- **No writes** — `host.dbExec` is never called. Zero INSERT/UPDATE/DELETE/DROP.
- **No dispatch** — no side effects, no queue commits.
- **No digest** — interactive questions only; scheduled aggregations belong to
  `skill-pa briefing`.
- **No cross-domain aggregation as a lib** — panes compute their own KPIs
  client-side; this skill is for operator questions in the dock chat.
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery` SELECT-only.

---

## Critical files

```
query/
├── SKILL.md                  ← you are here (router + G-04 frontmatter)
├── lib/state.md              ← table-scope contract + SELECT-only proof
└── actions/
    └── query.md              ← the single action (ActionFrontmatter + body)
```

---

## R-03 closure note

This skill permanently closes R-03 ("five Supabase query skills share one
foundation — consolidate"). The five retired surfaces and their absorption are
documented in the package `README.md` absorption table. Domain skills NEVER
ship query actions; any "ask the db" surface routes through skill-query.
