---
name: research
description: |
  Research dispatch — source-sweep with stale-refresh and dossier-commission
  proposals, and report-draft surface for the research domain. Reads `ikenga.db`
  via `host.dbQuery` (SELECT-only, `research_notes` + `research_sources`); approved
  proposals dispatch through the host write path. DISPATCH-ONLY: research CRUD
  belongs to the research app pkg (`com.ikenga.research`), not here.

  TRIGGER when the user asks for a research sweep, source freshness check,
  dossier commission proposals, or to draft a new research report or persona in chat.

  DO NOT TRIGGER for research CRUD (create/edit/delete/reassign from skill). Route
  those to the research app pkg. DO NOT run KPI math — that stays client-side in
  the pane (R-03). DO NOT run web-scraping or real-time source fetching — source
  re-scraping is dispatched through the host after operator approval.
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# research — dispatch-only research pipeline surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope) is in `lib/state.md` — read it
before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` ships as `com.ikenga.skill-core` on `ikenga-pkgs` main.
> Per the G-04 contract and the lint spec in `06-skill-action-contract.md` §5,
> no other target is legal.

> **Pipeline-stages convention:** This skill extends the R-04 Pipeline-stages
> convention to the research domain. `research-sweep` proposals carry `ux_mode`
> per the §Pipeline-stages mapping — `silent` for intra-stage agent moves,
> `confirm` for operator one-offs, `approve` for any outward dispatch (hand-to-sales,
> source re-scrape trigger) or any terminal-crossing action. The research stage enum is:
> `draft → review → validated` (terminal: `archived`).
> See `06-skill-action-contract.md` §Pipeline-stages.

> **R-03 (Query-collapse):** No query actions are present. Domain skills are
> permanently dispatch-only. Interactive questions route through `skill-query`.

---

## Purpose (one line)

Surface next-action proposals for monitored sources (stale refresh) and open
research notes (stage-advance, dossier commission, hand-to-sales) — reading
`ikenga.db` state, never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure the research pipeline: monitored sources, cadences, default depth, owner. Writes `.atelier/skill-research/manifest.json`. |
| `research-sweep` | [`actions/research-sweep.md`](actions/research-sweep.md) | `approve` | Read open research notes + monitored sources, produce stale-refresh and dossier-advance proposals with evidence; pause for operator approval. |
| `draft-report` | [`actions/draft-report.md`](actions/draft-report.md) | `confirm` | Draft a new research report or dossier in dock chat (D-02 setup-in-chat pattern); pane/host path writes the row. |

All three actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "sweep research sources", "what needs refreshing", "flag stale sources", "research review", "commission dossier" | [`actions/research-sweep.md`](actions/research-sweep.md) | Read `research_notes` + `research_sources`; produce proposals; pause for approval |
| "setup research", "configure skill-research", "what sources are we monitoring" | [`actions/setup.md`](actions/setup.md) | `ai_infer` or `interview` mode; confirm sources + cadences + depth + owner in chat; write `.atelier/skill-research/manifest.json` |
| "add a report", "new research note", "draft a dossier", "new competitor teardown", "new persona", "new prospect brief" | [`actions/draft-report.md`](actions/draft-report.md) | Draft report fields in chat; confirm; pane/host writes the row |

---

## What skill-research does NOT do

- **No research CRUD** — create/edit/delete/reassign research notes belongs to the research app pkg (`com.ikenga.research`).
- **No KPI math** — counts, freshness scores, and fit scores stay client-side in the pane (R-03).
- **No web-scraping** — live source fetching and re-scraping are dispatched through the host after operator approval; the skill surfaces the proposal, it does not fetch.
- **No cross-domain writes** — the "Hand to sales" proposal surfaces in `research-sweep` as an `approve`-mode proposal; the host/pane commits the `sales_deals` link. This skill never writes to `sales_deals`.
- **No query actions** — interactive data questions route through `skill-query` (R-03 Query-collapse).
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery` only.
- **No direct DB writes from skill** — approved proposals dispatch through the host write path; the skill never writes to the DB.

---

## Critical files

```
research/
├── SKILL.md                      ← you are here (router only)
├── lib/state.md                  ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md                  ← WP-22a body
    ├── research-sweep.md         ← WP-22a body
    └── draft-report.md           ← WP-22a body
```
