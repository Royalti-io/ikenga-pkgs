---
name: draft-deal
description: Draft a new deal in the dock chat (the sales screen "Add deal" key action). Confirmed creation is written by the pane/host path, not this skill.
domain: sales
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    company:
      type: string
      description: Company name for the new deal.
    contact_name:
      type: string
      description: Primary contact at the company.
    stage:
      type: string
      description: Initial pipeline stage. Defaults to 'lead' if omitted.
    value:
      type: number
      minimum: 0
      description: Estimated deal value (in project currency).
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft New Deal

    Gather the fields for a new sales deal in chat (D-02 — setup-in-chat pattern).
    Do NOT write to the database — the pane/host path writes the row after the
    operator confirms.

    ## Fields to collect (ask for any not supplied as inputs)

    1. **Company** — company name (pre-filled: {{company}} if provided)
    2. **Contact name** — primary contact (pre-filled: {{contact_name}} if provided)
    3. **Contact email** — primary contact's email (needed for the `contacts` join)
    4. **Stage** — initial stage, default `lead` (pre-filled: {{stage}} if provided)
    5. **Value** — estimated deal value (pre-filled: {{value}} if provided)
    6. **Currency** — ISO 4217 code, default `USD`
    7. **Source** — acquisition channel (inbound / outbound / referral / partner /
       self-serve / pilot)
    8. **Assigned to** — owner name or `sales-agent` (default: current operator)
    9. **Notes** — optional free-form notes or next action description

    ## Confirmation

    Present a draft deal summary in chat:

    ```
    NEW DEAL DRAFT
    Company:      <company>
    Contact:      <contact_name> <contact_email>
    Stage:        <stage>
    Value:        <currency> <value>
    Source:       <source>
    Assigned to:  <assigned_to>
    Notes:        <notes>
    ```

    Ask: "Confirm to create this deal, or edit any field."

    **Do NOT write to the database.** The pane/host path will write the row
    when the operator confirms via the `ux_mode: confirm` gate.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - chat
---

# action: draft-deal

> **WP-18a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Gathers the fields for a new sales deal in a dock-chat conversation (D-02 —
setup-in-chat pattern). Presents a draft summary for the operator to confirm or
edit. The pane/host path writes the row after confirmation — this skill performs
zero DB writes.

This is the skill-layer companion to the sales screen's **"Add deal" key action**
(`plans/atelier-design-system/parts/screens/sales.md` §1 Key actions — "Click
`.kb-add` in kanban column → Opens deal-creation flow in dock chat").

## CRUD boundary (R4)

`draft-deal` does NOT call `host.dbExec`. It is purely a chat-driven field
collection and preview action. The actual `INSERT INTO sales_deals` is performed
by:

1. The pane's `host.dbExec` call (when the operator clicks "Confirm" in the
   kanban `.kb-add` flow), OR
2. The shell-level deal-creation handler (when the `ux_mode: confirm` gate fires
   from the dock).

The skill surfaces the draft; the host commits it.

## No sqlite capability needed

`draft-deal` does NOT declare `sqlite` in `requires_capabilities` because it
makes no DB reads or writes. It collects data in chat and hands the draft to the
host. The only capability needed is `chat` (the dock chat conversation).

## Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02) — the same
setup-in-chat surface pattern applies to deal drafting.

## Fields written (by the host, not this skill)

When the host commits the confirmed deal draft, it writes these base columns to
`sales_deals`:

| Column | Source |
|---|---|
| `company` | Collected in chat |
| `contact_name` | Collected in chat |
| `contact_email` | Collected in chat |
| `stage` | Collected in chat (default: `lead`) |
| `value` | Collected in chat |
| `currency` | Collected in chat (default: `USD`) |
| `source` | Collected in chat |
| `assigned_to` | Collected in chat (default: current operator) |
| `notes` | Collected in chat (optional) |

App-layer columns added by the WP-18b migration (`title`, `next_action`,
`next_action_mode`, `win_probability`) are not set by this skill — the pane
populates them per its own logic after the base row is created.
