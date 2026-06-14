---
name: setup
description: Configure skill-strategy for the current project (active cycle, objective areas, owner agents). Writes .atelier/skill-strategy/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Strategy Skill Setup

    Configure skill-strategy for this project. Run in one of two modes:

    **ai_infer mode (default):** Examine the project context (README.md,
    .claude/CLAUDE.md, any existing .atelier/skill-strategy/manifest.json) to
    infer reasonable defaults, then confirm each value with the operator in chat
    before writing the instance file.

    **interview mode:** Walk the operator through the configuration questions
    one by one when the repo context is sparse or a fresh setup is required.

    ## Configuration questions (confirm or ask each)

    1. **Active cycle** — which planning cycle is currently active?
       Example: "Q2 2026", "H2 2026", "FY2026".
       Default: infer from current date (current quarter).

    2. **Objective areas** — what area / pillar columns organise the OKR board?
       Default: Company · Growth · Product · Finance
       Adjust for this organisation's actual pillars.

    3. **Owner agents** — which agents act as objective owners or reviewers?
       Default: cmo-agent · cfo-agent · product-agent · strategy-agent
       List additional domain agents that own objectives in this cycle.

    4. **At-risk thresholds** — when is an objective considered at risk?
       Default: overall_pct < 50 AND days_elapsed > 30 in the current cycle.
       Adjust either threshold before confirming.

    5. **Review schedule** — when should the strategy review run automatically?
       Default: Monday mornings at 09:00 (`0 9 * * 1`) — weekly cadence.
       Adjust for fortnightly or cycle-end-only schedules as needed.

    Present the full draft config in chat before writing. Do NOT write files
    until the operator explicitly approves.

    On approval write:

    **${CLAUDE_PROJECT_DIR}/.atelier/skill-strategy/manifest.json**
    ```json
    {
      "skill": "skill-strategy",
      "template_version": 1,
      "configured_at": "<ISO-8601>",
      "settings": {
        "active_cycle": "<cycle>",
        "objective_areas": ["Company", "Growth", "Product", "Finance"],
        "owner_agents": ["cmo-agent", "cfo-agent", "product-agent", "strategy-agent"],
        "at_risk_threshold_pct": 50,
        "at_risk_threshold_days_elapsed": 30,
        "review_cron": "0 9 * * 1"
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
    - ".atelier/skill-strategy/manifest.json"
---

# action: setup

> **WP-23a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

The `setup` lifecycle action for skill-strategy. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8).

Setup localises the skill per project by confirming the active cycle,
objective areas, owner agents, at-risk thresholds, and review schedule in a
dock-chat conversation (D-02 — setup-in-chat pattern). It then writes the
project-local instance file at `${CLAUDE_PROJECT_DIR}/.atelier/skill-strategy/manifest.json`.

### Modes

Both `ai_infer` and `interview` are supported (`SetupMode`). The `run.prompt`
implements `ai_infer`; the shell can invoke `interview` mode with scripted
questions when the repo context is sparse.

### Instance file written

`manifest.json` (WP-06 lifecycle) — the skill instance config with:
- `active_cycle` — the current planning cycle label (e.g. "Q2 2026")
- `objective_areas` — the area/pillar columns on the OKR board
- `owner_agents` — agent slugs that act as objective owners or reviewers
- `at_risk_threshold_pct` — overall progress below this % is flagged at-risk
- `at_risk_threshold_days_elapsed` — days into the cycle before at-risk flags apply
- `review_cron` — the schedule for `strategy-review` (default Monday 09:00)

### Strategy ux-mode map (business rules)

Setup does NOT configure the ux-mode map — ux_mode is declared per objective
in the `strategy_objectives` table (or derived from `strategic_initiatives`).
The three modes are fixed by the domain contract (`lib/state.md`):
- `silent` — agent acts autonomously (nightly metric syncs, auto-refresh)
- `confirm` — operator must confirm before the agent proceeds
- `approve` — operator must countersign before an outward commit fires (E-11)

### Capabilities

- `fs` — writes the instance file under `.atelier/skill-strategy/`.
- `chat` — the confirm-in-chat conversation (D-02). No `sqlite` needed —
  setup does not read `ikenga.db`.

**No DB reads or writes.** Setup is purely a project-config action.

### Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02, locked R9)
specify the chat surface for this action.
