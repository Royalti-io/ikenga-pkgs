---
name: setup
description: Configure skill-sales for the current project (stage enum, win-probability defaults, quarter target). Writes .atelier/skill-sales/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Sales Pipeline Setup

    Configure skill-sales for this project. Run in one of two modes:

    **ai_infer mode (default):** Examine the project context (README.md,
    .claude/CLAUDE.md, any existing .atelier/skill-sales/manifest.json) to
    infer reasonable defaults, then confirm each value with the operator in chat
    before writing the instance file.

    **interview mode:** Walk the operator through the configuration questions
    one by one when the repo context is sparse or a fresh setup is required.

    ## Configuration questions (confirm or ask each)

    1. **Stage enum** — confirm the pipeline stages in order:
       `lead → qualified → proposal → negotiation → closing → won | lost`
       Are these the stages you use? (yes / list your stages)

    2. **Win-probability defaults** — confirm the win-probability (0–1) for
       each non-terminal stage. Suggested defaults:
       - lead: 0.10
       - qualified: 0.25
       - proposal: 0.40
       - negotiation: 0.65
       - closing: 0.85
       - won: 1.00 (fixed)
       - lost: 0.00 (fixed)
       Adjust any values before confirming.

    3. **Quarter target** — what is your revenue target for the current quarter
       (in the same currency as deal values)? Default: 300000.

    4. **Stale threshold** — how many days in a stage before a deal is flagged
       as stale in the pipeline-sweep? Default: 30.

    Present the full draft config in chat before writing. Do NOT write files
    until the operator explicitly approves.

    On approval write:

    **${CLAUDE_PROJECT_DIR}/.atelier/skill-sales/manifest.json**
    ```json
    {
      "skill": "skill-sales",
      "template_version": 1,
      "configured_at": "<ISO-8601>",
      "settings": {
        "stage_enum": ["lead", "qualified", "proposal", "negotiation", "closing", "won", "lost"],
        "win_probability": {
          "lead": 0.10,
          "qualified": 0.25,
          "proposal": 0.40,
          "negotiation": 0.65,
          "closing": 0.85,
          "won": 1.00,
          "lost": 0.00
        },
        "quarter_target": 300000,
        "stale_threshold_days": 30,
        "sweep_cron": "0 8 * * 1-5"
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
  mode: ai_infer
  template_version: 1
  infer_sources:
    - "README.md"
    - ".claude/CLAUDE.md"
    - ".atelier/skill-sales/manifest.json"
---

# action: setup

> **WP-18a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

The `setup` lifecycle action for skill-sales. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8).

Setup localises the skill per project by confirming the stage enum, win-probability
defaults, quarter target, and stale threshold in a dock-chat conversation (D-02 —
setup-in-chat pattern). It then writes the project-local instance file at
`${CLAUDE_PROJECT_DIR}/.atelier/skill-sales/manifest.json`.

### Modes

Both `ai_infer` and `interview` are supported (`SetupMode`). The `run.prompt`
implements `ai_infer`; the shell can invoke `interview` mode with scripted
questions when the repo context is sparse.

### Instance file written

`manifest.json` (WP-06 lifecycle) — the skill instance config with:
- `stage_enum` — the ordered pipeline stages (terminals: `won`, `lost`)
- `win_probability` — per-stage defaults used by `pipeline-sweep` to compute
  weighted-pipeline proposals
- `quarter_target` — the revenue target for the current quarter
- `stale_threshold_days` — days in stage before a deal is flagged as stale
- `sweep_cron` — the schedule for `pipeline-sweep` (default weekday 08:00)

### Pipeline-stages convention (R-04)

`setup` confirms the **stage enum** per the Pipeline-stages convention
(`06-skill-action-contract.md §Pipeline-stages`). The enum is validated during
setup: terminals (`won`, `lost`) must be present; the domain owns the TEXT
column on `sales_deals.stage`.

### Capabilities

- `fs` — writes the instance file under `.atelier/skill-sales/`.
- `chat` — the confirm-in-chat conversation (D-02). No `sqlite` needed —
  setup does not read `ikenga.db`.

**No DB reads or writes.** Setup is purely a project-config action.

### Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02, locked R9)
specify the chat surface for this action.
