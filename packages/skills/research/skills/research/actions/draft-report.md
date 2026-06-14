---
name: draft-report
description: Draft a new research report or dossier in the dock chat (the research screen "New report" key action). Confirmed creation is written by the pane/host path, not this skill.
domain: research
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    title:
      type: string
      description: Working title for the research report or dossier.
    entity_type:
      type: string
      enum: ["persona", "icp", "competitor", "prospect", "market", "ddex"]
      description: Research type.
    entity_name:
      type: string
      description: "Subject name (e.g. 'DistroKid', 'Mavin Records', 'Nigerian streaming market 2026')."
    research_depth:
      type: string
      enum: ["brief", "standard", "deep"]
      description: "Research depth. brief = summary only; standard = full with sources; deep = multi-source synthesis."
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft New Research Report

    Gather the fields for a new research report or dossier in chat (D-02 —
    setup-in-chat pattern). Do NOT write to the database — the pane/host path
    writes the row after the operator confirms.

    ## Fields to collect (ask for any not supplied as inputs)

    1. **Title** — working title for the report or dossier
       (pre-filled: {{title}} if provided)

    2. **Type** — research type:
       - persona / icp — ICP definition or persona card
       - competitor — competitive teardown or analysis
       - prospect — prospect dossier for hand-to-sales dispatch
       - market — market research or trend analysis
       - ddex — DDEX spec digest or standard summary
       (pre-filled: {{entity_type}} if provided)

    3. **Subject** — the named subject of the research:
       - persona/icp → persona name (e.g. "Label finance managers")
       - competitor → competitor name (e.g. "DistroKid", "TuneCore")
       - prospect → company name (e.g. "Mavin Records", "Chocolate City")
       - market → topic / market name (e.g. "Nigerian streaming market 2026")
       - ddex → spec name (e.g. "ERN 4.3", "DSR 2.0")
       (pre-filled: {{entity_name}} if provided)

    4. **Research depth** — how thorough should this research be?
       - brief — short summary, 2–3 sources
       - standard — full report with 5–9 sources
       - deep — multi-source synthesis + personas + competitive mapping
       Default: standard (or from .atelier/skill-research/manifest.json)
       (pre-filled: {{research_depth}} if provided)

    5. **Owner** — who will own this research item?
       Options: current operator / research-agent (for agent-commissioned items)
       Default: configured owner from .atelier/skill-research/manifest.json

    6. **Initial stage** — where does this report start?
       Options: draft / review
       Default: draft (the agent will populate from sources; operator reviews)

    7. **Tags** — optional tags for filtering (e.g. ["competitive", "q2", "pricing"])

    8. **Brief / notes** — optional one-paragraph research brief or context
       specifying key questions, source hints, or output format expectations

    ## Prospect dossier reminder

    If type = prospect or icp, remind the operator:
    - The "Hand to sales" action (R-05/R-06 pattern) is available once this
      dossier reaches `status = 'validated'`.
    - The `research-sweep` action will surface a hand-to-sales proposal at
      the next sweep once validated.
    - The pane/host path sets `entity_id` to the relevant `sales_deals.id`
      when the cross-domain link is established.

    ## Confirmation

    Present a draft report summary in chat:

    ```
    NEW RESEARCH DRAFT
    Title:       <title>
    Type:        <entity_type>
    Subject:     <entity_name>
    Depth:       <research_depth>
    Owner:       <researched_by>
    Stage:       <status>
    Tags:        <tags or —>
    Brief:       <notes or —>
    ```

    Ask: "Confirm to create this report, or edit any field."

    **Do NOT write to the database.** The pane/host path will write the row
    when the operator confirms via the `ux_mode: confirm` gate.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - chat
---

# action: draft-report

> **WP-22a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Gathers the fields for a new research report or dossier in a dock-chat conversation
(D-02 — setup-in-chat pattern). Presents a draft summary for the operator to
confirm or edit. The pane/host path writes the row after confirmation — this skill
performs zero DB writes.

This is the skill-layer companion to the research screen's **"New report" key action**
(`plans/atelier-design-system/parts/screens/research.md` §1 Key actions —
"frame-head 'New report' button → Opens inline CreateReportForm").

## CRUD boundary (R4)

`draft-report` does NOT call `host.dbExec`. It is purely a chat-driven field
collection and preview action. The actual `INSERT INTO research_notes` is performed by:

1. The pane's `host.dbExec` call (when the operator confirms in the research screen's
   `CreateReportForm`), OR
2. The shell-level report-creation handler (when the `ux_mode: confirm` gate fires
   from the dock).

The skill surfaces the draft; the host commits it.

## No sqlite capability needed

`draft-report` does NOT declare `sqlite` in `requires_capabilities` because it
makes no DB reads or writes. It collects data in chat and hands the draft to the
host. The only capability needed is `chat` (the dock chat conversation).

## Prospect dossiers — hand-to-sales reminder

If the operator selects `entity_type = prospect` or `entity_type = icp`, the action:
- Reminds the operator that validated dossiers can be dispatched to Sales via
  `research-sweep`'s "Hand to sales" approve-mode proposal (R-05/R-06 pattern).
- Proceeds to draft the report with all standard fields.
- Does NOT collect `sales_deals.id` — the cross-domain link is established by
  the host/pane when the hand-to-sales action is approved at a later sweep.

The created row in `research_notes` will have `entity_type IN ('prospect', 'icp')`
and will surface in `research-sweep` as a hand-to-sales candidate once `status`
reaches `validated`.

## No web-scraping (R4)

`draft-report` does not trigger any web-scraping or agent research job. It drafts
the administrative fields only (title, type, subject, depth, owner, stage, tags,
brief). The research-agent job that populates `body`, `source_urls`, and `summary`
is dispatched separately (via `research-sweep` proposals or directly by the operator
from the research screen).

## Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02) — the same
setup-in-chat surface pattern applies to report drafting.
`plans/atelier-design-system/parts/screens/research.md` §"Key actions" specifies
the "New report" CTA surface.

## Fields written (by the host, not this skill)

When the host commits the confirmed report draft, it writes these base columns to
`research_notes`:

| Column | Source |
|---|---|
| `id` | Generated by host |
| `title` | Collected in chat |
| `entity_type` | Collected in chat |
| `entity_name` | Collected in chat |
| `entity_id` | NULL at creation; set by host/pane when cross-domain link established |
| `summary` | NULL at creation; populated by agent on research run |
| `body` | NULL at creation; populated by agent on research run |
| `source_urls` | `'[]'` at creation; populated by agent on research run |
| `research_depth` | Collected in chat (default: standard) |
| `tags` | Collected in chat as JSON array (e.g. '["competitive"]') |
| `fit_score` | NULL at creation; populated by agent for persona/icp types |
| `fit_notes` | NULL at creation; populated by agent for persona/icp types |
| `status` | Collected in chat (default: `draft`) |
| `researched_by` | Collected in chat |

Extended domain columns added by the WP migration (`next_action`, `next_action_target`,
`agent_cycle_id`, `is_stale`, `word_count`, `owner`) are not set by this skill —
the pane populates them per its own logic after the base row is created.
