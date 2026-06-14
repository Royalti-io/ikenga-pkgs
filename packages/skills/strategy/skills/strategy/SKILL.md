---
name: strategy
description: |
  Strategy dispatch — OKR review with countersign proposals, at-risk flagging,
  and objective-draft surface for the strategy domain. Reads `ikenga.db` via
  `host.dbQuery` (SELECT-only); approved review actions dispatch through the
  host write path. DISPATCH-ONLY: strategy CRUD belongs to the strategy app
  pkg (`com.ikenga.strategy`), not here.

  TRIGGER when the user asks for a strategy review, OKR sweep, cycle summary,
  at-risk objective flags, or to draft a new objective in chat.

  DO NOT TRIGGER for strategy CRUD (create/edit/delete/reassign from skill).
  Route those to the strategy app pkg. DO NOT run KPI math — that stays
  client-side in the pane (R-03). DO NOT query cross-domain tables directly —
  KR progress proxies from finance/sales stay client-side.
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# strategy — dispatch-only OKR surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope) is in `lib/state.md` — read it
before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` ships as `com.ikenga.skill-core` on `ikenga-pkgs` main.
> Per the G-04 contract and the lint spec in `06-skill-action-contract.md` §5,
> no other target is legal.

> **Pipeline-stages convention:** This skill extends the R-04 Pipeline-stages
> convention to the strategy domain. `strategy-review` proposals carry `ux_mode`
> per the §Pipeline-stages mapping — `silent` for agent-auto moves (nightly
> metric syncs), `confirm` for operator one-offs (confirm weekly review agenda),
> `approve` for terminal-crossing or outward-committing actions (countersign a
> SAFE, approve a GA checklist). The strategy ux-mode map is: O-01..O-08 carry
> one of `confirm` / `approve` / `silent` per the strategy screen fixture.
> See `06-skill-action-contract.md` §Pipeline-stages.

> **R-03 (Query-collapse):** No query actions are present. Domain skills are
> permanently dispatch-only. Interactive questions route through `skill-query`.

---

## Purpose (one line)

Surface next-action proposals for open objectives and flag at-risk OKRs —
reading `ikenga.db` state (existing base tables only), never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure the strategy skill: active cycle/quarter, objective areas, owner agents. Writes `.atelier/skill-strategy/manifest.json`. |
| `strategy-review` | [`actions/strategy-review.md`](actions/strategy-review.md) | `approve` | Run the weekly/cycle OKR review — read open objectives and KR state, draft countersign proposals with evidence, flag at-risk objectives; pause for operator approval. |
| `draft-objective` | [`actions/draft-objective.md`](actions/draft-objective.md) | `confirm` | Draft a new objective in dock chat (D-02 setup-in-chat pattern); pane/host path writes the row. |

All three actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "run the OKR review", "weekly strategy review", "flag at-risk objectives", "cycle review", "countersign objectives" | [`actions/strategy-review.md`](actions/strategy-review.md) | Read objectives + evidence; produce countersign proposals; pause for approval |
| "setup strategy", "configure skill-strategy", "what cycle are we in", "set up OKR areas" | [`actions/setup.md`](actions/setup.md) | `ai_infer` or `interview` mode; confirm cycle/areas/owners in chat; write `.atelier/skill-strategy/manifest.json` |
| "add an objective", "new objective", "draft an OKR", "create strategic goal" | [`actions/draft-objective.md`](actions/draft-objective.md) | Draft objective fields in chat; confirm; pane/host writes the row |

---

## What skill-strategy does NOT do

- **No strategy CRUD** — create/edit/delete/reassign objectives belongs to the strategy app pkg (`com.ikenga.strategy`).
- **No KPI math** — OKR progress percentages, KR aggregation, and at-risk computation stay client-side in the pane (R-03).
- **No cross-domain queries** — KR progress fed by finance/sales domains is read by the pane client; this skill does not query `receivables`, `sales_deals`, or `transaction_ledger`.
- **No publish/send transport** — external commits (seed-round countersign, GA checklist approval) go through the host write path after the `approve` gate; the skill proposes, the host dispatches.
- **No query actions** — interactive data questions route through `skill-query` (R-03 Query-collapse).
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.
- **No direct DB writes from skill** — approved countersign actions dispatch through the host write path; the skill never writes to the DB.

---

## Critical files

```
strategy/
├── SKILL.md                      ← you are here (router only)
├── lib/state.md                  ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md                  ← WP-23a body
    ├── strategy-review.md        ← WP-23a body
    └── draft-objective.md        ← WP-23a body
```
