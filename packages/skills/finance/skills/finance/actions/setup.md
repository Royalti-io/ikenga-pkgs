---
name: setup
description: Configure skill-finance for the current project (entities, currencies, runway target, alert thresholds). Writes .atelier/skill-finance/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Finance Setup

    Configure skill-finance for this project. Run in interview mode: ask the
    operator each question in chat (D-02 — setup-in-chat pattern), then write
    the instance file once all values are confirmed.

    ## Interview questions (ask each in order)

    1. **Entities & currencies** — This skill ships with three default entities
       below. Confirm each is correct, or adjust/add/remove entities:
       - Royalti.io — USD + NGN
       - Dixtrit.media — USD
       - Personal (Chinedum) — NGN

       Ask: "Are these the entities and currencies you want to track? (yes / adjust)"

    2. **Base currency** — All multi-currency amounts are expressed in which
       base currency for KPI display? Default: USD.

    3. **Runway target** — How many months of runway is the target threshold
       (below which the Runway KPI card shows `.is-warn`)? Default: 12.

    4. **Runway danger threshold** — Below how many months does the Runway card
       escalate to `.is-danger`? Default: 6.

    5. **A/R overdue chase days** — After how many days overdue does an invoice
       enter the AR-chase queue? Default: 30.

    6. **A/R critical days** — After how many days does an invoice become
       critical (60+ bucket)? Default: 60.

    7. **Reconcile sweep schedule** — When should the weekly reconciliation
       sweep run? Default: weekdays at 07:00 AM (`0 7 * * 1-5`).

    Present the full draft config in chat before writing. Do NOT write files
    until the operator explicitly confirms.

    On confirmation write:

    **${CLAUDE_PROJECT_DIR}/.atelier/skill-finance/manifest.json**
    ```json
    {
      "skill": "skill-finance",
      "template_version": 1,
      "configured_at": "<ISO-8601>",
      "settings": {
        "entities": [
          { "name": "Royalti.io", "currencies": ["USD", "NGN"] },
          { "name": "Dixtrit.media", "currencies": ["USD"] },
          { "name": "Personal", "currencies": ["NGN"] }
        ],
        "base_currency": "USD",
        "runway_target_months": 12,
        "alert_thresholds": {
          "runway_warn_months": 12,
          "runway_danger_months": 6,
          "ar_overdue_chase_days": 30,
          "ar_critical_days": 60,
          "reconcile_sweep_cron": "0 7 * * 1-5"
        }
      }
    }
    ```

    Do NOT clobber an existing manifest.json — detect older template_version
    and run the migrate path forward instead (preserve operator-set settings,
    merge new keys with defaults).
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - fs
  - chat
setup:
  mode: interview
  template_version: 1
  interview_questions:
    - entities_currencies
    - base_currency
    - runway_target_months
    - runway_danger_months
    - ar_overdue_chase_days
    - ar_critical_days
    - reconcile_sweep_cron
---

# action: setup

> **WP-20a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

The `setup` lifecycle action for skill-finance. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8).

Setup localises the skill per project by interviewing the operator in a dock-chat
conversation (D-02 — setup-in-chat pattern) about entities, currencies, runway
target, and alert thresholds. It then writes the project-local instance file at
`${CLAUDE_PROJECT_DIR}/.atelier/skill-finance/manifest.json`.

### Mode: interview (D-02)

`setup.mode: interview` — the agent walks the operator through seven scripted
questions (`interview_questions`) one by one in the dock chat. This is preferred
over `ai_infer` for finance configuration because the entity/currency structure
and alert thresholds are business decisions that cannot be reliably inferred from
repo context; they require explicit operator input.

### Instance file written

`manifest.json` (WP-06 lifecycle) — the skill instance config with:
- `entities` — the ordered list of tracked entities and their functional currencies
- `base_currency` — ISO 4217 code used for cross-currency USD equivalents in KPI
- `runway_target_months` — months below which `.is-warn` appears on the Runway KPI
- `alert_thresholds.runway_warn_months` — warn threshold (default 12)
- `alert_thresholds.runway_danger_months` — danger threshold (default 6)
- `alert_thresholds.ar_overdue_chase_days` — days overdue before AR-chase surfaces the invoice
- `alert_thresholds.ar_critical_days` — days overdue before the 60+ critical bucket
- `alert_thresholds.reconcile_sweep_cron` — cron for the automatic reconcile-sweep

### Default entity config (Royalti.io multi-entity context)

The default config reflects the three-entity Royalti.io / Dixtrit.media / Personal
multi-entity setup (from `plans/atelier-design-system/parts/screens/finance.md` §1):

| Entity | Currencies | Notes |
|---|---|---|
| Royalti.io | USD, NGN | Primary operating entity; Mercury USD + Kuda NGN accounts |
| Dixtrit.media | USD | Verto USD payments |
| Personal | NGN | Kuda NGN personal account |

The operator confirms or adjusts this list during setup.

### Capabilities

- `fs` — writes the `.atelier/skill-finance/manifest.json` instance file.
- `chat` — the interview conversation in the dock chat (D-02). No `sqlite` needed —
  setup does not read `ikenga.db`.

**No DB reads or writes.** Setup is purely a project-config action.

### Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02, locked R9)
specify the chat surface for this action. The interview mode follows the
`atelier-setup-chat-interview.html` pattern.
