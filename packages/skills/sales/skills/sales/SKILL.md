---
name: sales
description: |
  Sales dispatch — pipeline-sweep with stage-advance proposals, stale-deal
  flagging, and deal-draft surface for the sales domain. Reads `ikenga.db` via
  `host.dbQuery` (SELECT-only, pre-0043 base columns only); approved
  stage-advances dispatch through the host write path. DISPATCH-ONLY: deal CRUD
  belongs to the sales app pkg (`com.ikenga.sales`), not here.

  TRIGGER when the user asks for a pipeline review, deal stage proposals, to
  flag stale deals, or to draft a new deal in chat.

  DO NOT TRIGGER for deal CRUD (create/edit/delete/reassign from skill). Route
  those to the sales app pkg. DO NOT run forecast math — that stays client-side
  in the pane (R-03).
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# sales — dispatch-only sales pipeline surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope, base-columns-only constraint) is in
`lib/state.md` — read it before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` ships as `com.ikenga.skill-core` on `ikenga-pkgs` main.
> Per the G-04 contract and the lint spec in `06-skill-action-contract.md` §5,
> no other target is legal.

> **Pipeline-stages convention:** This skill is the first consumer of the R-04
> Pipeline-stages convention (resolved Round 22). `pipeline-sweep` proposals
> carry `ux_mode` per the §Pipeline-stages mapping — `silent` for intra-stage
> agent moves, `confirm` for operator one-offs, `approve` for terminal-crossing
> or any outward dispatch. See `06-skill-action-contract.md` §Pipeline-stages.

---

## Purpose (one line)

Surface next-action proposals for open deals and flag pipeline-stall —
reading `ikenga.db` state (pre-0043 base columns only), never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure the sales pipeline: stage enum, win-probability defaults, quarter target. Writes `.atelier/skill-sales/manifest.json`. |
| `pipeline-sweep` | [`actions/pipeline-sweep.md`](actions/pipeline-sweep.md) | `approve` | Read open deals (pre-0043 columns), produce stage-advance proposals with evidence, flag deals stuck >30d; pause for operator approval. |
| `draft-deal` | [`actions/draft-deal.md`](actions/draft-deal.md) | `confirm` | Draft a new deal in dock chat (D-02 setup-in-chat pattern); pane/host path writes the row. |

All three actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "sweep the pipeline", "what deals need attention", "flag stale deals", "pipeline review" | [`actions/pipeline-sweep.md`](actions/pipeline-sweep.md) | Read `sales_deals` (base cols) + evidence; produce proposals; pause for approval |
| "setup sales", "configure skill-sales", "what stages are we using" | [`actions/setup.md`](actions/setup.md) | `ai_infer` or `interview` mode; confirm stage enum + win-probs + target in chat; write `.atelier/skill-sales/manifest.json` |
| "add a deal", "new deal", "draft a deal", "create deal" | [`actions/draft-deal.md`](actions/draft-deal.md) | Draft deal fields in chat; confirm; pane/host writes the row |

---

## What skill-sales does NOT do

- **No deal CRUD** — create/edit/delete/reassign deals belongs to the sales app pkg (`com.ikenga.sales`).
- **No forecast math** — `weighted = Σ(value × win_probability)` stays client-side in the pane (R-03).
- **No post-0043 columns** — `pipeline-sweep` reads only pre-0043 base columns (`stage`, `value`, `score`, `last_contact`, `assigned_to`). App-layer columns added by the WP-18b migration are not queried here.
- **No send** — outbound dispatch belongs to `skill-outbound`.
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.
- **No direct DB writes from skill** — approved stage-advances dispatch through the host write path; the skill never writes to the DB.

---

## Critical files

```
sales/
├── SKILL.md                      ← you are here (router only)
├── lib/state.md                  ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md                  ← WP-18a body
    ├── pipeline-sweep.md         ← WP-18a body
    └── draft-deal.md             ← WP-18a body
```
