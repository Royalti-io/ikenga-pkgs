---
name: draft-objective
description: Draft a new objective in the dock chat (the strategy screen "Add objective" key action). Confirmed creation is written by the pane/host path, not this skill.
domain: strategy
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    title:
      type: string
      description: Working title for the objective.
    area:
      type: string
      enum: ["Company", "Growth", "Product", "Finance"]
      description: "Objective area / board column (e.g. 'Company', 'Growth', 'Product', 'Finance')."
    cycle:
      type: string
      description: "Planning cycle (e.g. 'Q2 2026'). Defaults to active_cycle from .atelier/skill-strategy/manifest.json."
    owner:
      type: string
      description: "Objective owner (human email or agent slug: 'cmo-agent', 'cfo-agent', 'product-agent', 'strategy-agent')."
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft New Objective

    Gather the fields for a new strategic objective in chat (D-02 — setup-in-chat
    pattern). Do NOT write to the database — the pane/host path writes the row
    after the operator confirms.

    ## Fields to collect (ask for any not supplied as inputs)

    1. **Title** — working title for the objective (pre-filled: {{title}} if provided)
       Example: "Reach $1.2M ARR by Q4", "Ship Atelier P2 (skills)"

    2. **Area** — which board column / pillar does this belong to?
       Options: Company · Growth · Product · Finance
       (pre-filled: {{area}} if provided, or infer from title context)

    3. **Cycle** — which planning cycle does this objective belong to?
       Default: active_cycle from .atelier/skill-strategy/manifest.json
       (pre-filled: {{cycle}} if provided, or load from manifest)

    4. **Owner** — who owns this objective?
       Options: human email (e.g. nedjamez) or agent slug
       (cmo-agent / cfo-agent / product-agent / strategy-agent)
       (pre-filled: {{owner}} if provided)

    5. **UX mode** — what type of next-action does this objective require?
       Options:
       - `confirm` — operator confirms before agent proceeds (most common)
       - `approve` — operator must countersign before external commit fires
         (use for legal, financial, or outward-dispatch actions)
       - `silent` — agent acts autonomously on a schedule (no operator prompt)

    6. **Next action** — the specific action proposed for the current cycle
       (e.g. "Review weekly metric", "Countersign the SAFE", "Draft outreach sequence")
       Leave blank if not yet known.

    7. **Success criteria** — definition of done for this objective (optional)

    8. **Key results** — initial KR list (optional, one per line):
       Format: "label — target" (e.g. "ARR to $1.2M — 64%")
       The pane/host creates the `strategy_key_results` rows from this list.

    ## Confirmation

    Present a draft objective summary in chat:

    ```
    NEW OBJECTIVE DRAFT
    Title:            <title>
    Area:             <area>
    Cycle:            <cycle>
    Owner:            <owner>
    UX mode:          <ux_mode>
    Next action:      <next_action or —>
    Success criteria: <success_criteria or —>
    Key results:
      - <kr label — target>
      ...
    ```

    Ask: "Confirm to create this objective, or edit any field."

    **Do NOT write to the database.** The pane/host path will write the row
    (to `strategy_objectives`) and the KR rows (to `strategy_key_results`)
    when the operator confirms via the `ux_mode: confirm` gate.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - chat
---

# action: draft-objective

> **WP-23a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Gathers the fields for a new strategic objective in a dock-chat conversation
(D-02 — setup-in-chat pattern). Presents a draft summary for the operator to
confirm or edit. The pane/host path writes the row after confirmation — this
skill performs zero DB writes.

This is the skill-layer companion to the strategy screen's **"Add objective"
key action** (`plans/atelier-design-system/parts/screens/strategy.md` §1 Key
actions — "Click `.kb-add` in a column → Opens objective-creation flow in dock
Chi chat (setup-in-chat pattern)").

## CRUD boundary (R4)

`draft-objective` does NOT call `host.dbExec`. It is purely a chat-driven field
collection and preview action. The actual `INSERT INTO strategy_objectives` (and
`strategy_key_results` for KR rows) is performed by:

1. The pane's `host.dbExec` call (when the operator clicks "Confirm" in the
   kanban `.kb-add` flow), OR
2. The shell-level objective-creation handler (when the `ux_mode: confirm` gate
   fires from the dock).

The skill surfaces the draft; the host commits it.

## No sqlite capability needed

`draft-objective` does NOT declare `sqlite` in `requires_capabilities` because
it makes no DB reads or writes. It collects data in chat and hands the draft to
the host. The only capability needed is `chat` (the dock chat conversation).

## UX mode assignment (business rules)

The `ux_mode` collected for the draft objective determines how the pane's
`.pl-next` action button renders and how `strategy-review` treats the objective:

- `confirm` — the pane renders "Confirm & run"; agent waits for gate.
- `approve` — the pane renders "Approve & run" with `.btn.affirmative`; the host
  requires a countersign before any external commit. Recommend for objectives
  involving legal, financial, or third-party-dispatch next actions.
- `silent` — no action button rendered; the next action label is read-only,
  driven by a scheduled agent. Recommend for nightly metric syncs and
  auto-refresh objectives.

## Area assignment (board column)

The `area` field maps directly to the OKR board column grouping
(`ties_to_goal` in `strategic_initiatives`, or `area` in `strategy_objectives`).
If the operator is drafting an objective from a `.kb-add` click, the pre-seeded
area name from the column is passed as the `area` input. If the area is
ambiguous, ask the operator to clarify which pillar the objective belongs to.

## Key results (optional collection)

If the operator provides key results in the draft, the action formats them as
a structured list so the pane/host can create `strategy_key_results` rows at
commit time. Each KR carries:
- `label` — the measurable description
- `pct` — initial progress (default 0)
- `is_low` / `is_mid` flags (computed by the host: is_low if pct < 33, is_mid
  if pct 33–65, neither if pct >= 66)

The skill does NOT compute these flags — it passes the raw label/target from
chat and the host applies the flag logic.

## No cross-domain data collection

`draft-objective` does not collect finance metrics, sales forecasts, or RICE
scores. Cross-domain data (KR progress fed by finance/sales) is populated by
the pane client after the row is created. The skill drafts the objective's
editorial fields and stages it with `overall_pct = 0`.

## Fields written (by the host, not this skill)

When the host commits the confirmed objective draft, it writes these columns
to `strategy_objectives`:

| Column | Source |
|---|---|
| `id` | Generated by host |
| `title` | Collected in chat |
| `area` | Collected in chat (or pre-seeded from kb-add context) |
| `cycle_id` | Resolved from `strategy_cycles` by the host using the cycle name |
| `overall_pct` | Set to 0 at creation |
| `owner` | Collected in chat |
| `ux_mode` | Collected in chat |
| `next_action` | Collected in chat (nullable) |
| `created_at` | Set by host at INSERT time |

If `strategy_objectives` does not yet exist (schema TBD), the host creates the
table on first launch (per the domain WP recipe). This skill does not create
tables.
