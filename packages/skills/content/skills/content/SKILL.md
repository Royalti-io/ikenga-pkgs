---
name: content
description: |
  Content dispatch — pipeline-sweep with stage-advance proposals, stale-piece
  flagging, and piece-draft surface for the content domain. Reads `ikenga.db` via
  `host.dbQuery` (SELECT-only, pre-0047 base columns only); approved
  stage-advances dispatch through the host write path. DISPATCH-ONLY: content
  CRUD belongs to the content app pkg (`com.ikenga.content`), not here.

  TRIGGER when the user asks for a content pipeline review, editorial stage
  proposals, to flag stale pieces, or to draft a new content piece in chat.

  DO NOT TRIGGER for content CRUD (create/edit/delete/reassign from skill). Route
  those to the content app pkg. DO NOT run KPI math — that stays client-side in
  the pane (R-03). DO NOT produce, render, or schedule video — video production
  belongs to com.ikenga.studio (G-VIDEO-STACK, R23).
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# content — dispatch-only content pipeline surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope, base-columns-only constraint) is in
`lib/state.md` — read it before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` ships as `com.ikenga.skill-core` on `ikenga-pkgs` main.
> Per the G-04 contract and the lint spec in `06-skill-action-contract.md` §5,
> no other target is legal.

> **Pipeline-stages convention:** This skill extends the R-04 Pipeline-stages
> convention to the content domain. `pipeline-sweep` proposals carry `ux_mode`
> per the §Pipeline-stages mapping — `silent` for intra-stage agent moves,
> `confirm` for operator one-offs, `approve` for terminal-crossing or any
> outward dispatch. The content stage enum is:
> `idea → outline → draft → review → scheduled` (terminal: `published`).
> See `06-skill-action-contract.md` §Pipeline-stages.

> **G-VIDEO-STACK (R23):** Video pieces appear in the pipeline as tracking
> entries only. No video-production actions ship in this skill. Remotion-based
> production belongs to `com.ikenga.studio`.

> **R-03 (Query-collapse):** No query actions are present. Domain skills are
> permanently dispatch-only. Interactive questions route through `skill-query`.

---

## Purpose (one line)

Surface next-action proposals for open content pieces and flag editorial
pipeline-stall — reading `ikenga.db` state (pre-0047 base columns only), never
owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure the content pipeline: channels, series, cadence. Writes `.atelier/skill-content/manifest.json`. |
| `pipeline-sweep` | [`actions/pipeline-sweep.md`](actions/pipeline-sweep.md) | `approve` | Read open pieces (pre-0047 columns), produce stage-advance proposals with evidence, flag pieces stuck past stale threshold; pause for operator approval. |
| `draft-piece` | [`actions/draft-piece.md`](actions/draft-piece.md) | `confirm` | Draft a new content piece in dock chat (D-02 setup-in-chat pattern); pane/host path writes the row. |

All three actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "sweep the content pipeline", "what pieces need attention", "flag stale pieces", "editorial review" | [`actions/pipeline-sweep.md`](actions/pipeline-sweep.md) | Read `content_calendar` (base cols) + evidence; produce proposals; pause for approval |
| "setup content", "configure skill-content", "what channels are we using" | [`actions/setup.md`](actions/setup.md) | `ai_infer` or `interview` mode; confirm channels + series + cadence in chat; write `.atelier/skill-content/manifest.json` |
| "add a piece", "new content piece", "draft a post", "create blog post", "new newsletter", "new social post" | [`actions/draft-piece.md`](actions/draft-piece.md) | Draft piece fields in chat; confirm; pane/host writes the row |

---

## What skill-content does NOT do

- **No content CRUD** — create/edit/delete/reassign pieces belongs to the content app pkg (`com.ikenga.content`).
- **No KPI math** — views, engagement, published counts stay client-side in the pane (R-03).
- **No video production** — rendering, encoding, Remotion jobs belong to `com.ikenga.studio` (G-VIDEO-STACK, R23). Video pieces are tracked in the pipeline (stage/owner/due) but no production action runs here.
- **No publish/send transport** — scheduling social posts, sending newsletters, and triggering deploys belong to `skill-outbound` (R22). This skill proposes; it does not dispatch outward.
- **No post-0047 columns** — `pipeline-sweep` reads only pre-0047 base columns from `content_calendar`. App-layer columns added by the WP-21b migration are not queried here.
- **No query actions** — interactive data questions route through `skill-query` (R-03).
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.
- **No direct DB writes from skill** — approved stage-advances dispatch through the host write path; the skill never writes to the DB.

---

## Critical files

```
content/
├── SKILL.md                      ← you are here (router only)
├── lib/state.md                  ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md                  ← WP-21a body
    ├── pipeline-sweep.md         ← WP-21a body
    └── draft-piece.md            ← WP-21a body
```
