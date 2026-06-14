---
name: setup
description: Configure skill-research for the current project (monitored sources, cadences, default depth, owner). Writes .atelier/skill-research/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Research Pipeline Setup

    Configure skill-research for this project. Run in one of two modes:

    **ai_infer mode (default):** Examine the project context (README.md,
    .claude/CLAUDE.md, any existing .atelier/skill-research/manifest.json) to
    infer reasonable defaults, then confirm each value with the operator in chat
    before writing the instance file.

    **interview mode:** Walk the operator through the configuration questions
    one by one when the repo context is sparse or a fresh setup is required.

    ## Configuration questions (confirm or ask each)

    1. **Monitored sources** — which external sources should skill-research track
       for freshness and signal detection?
       Types: market · ddex · competitor · prospect
       Examples:
       - "Spotify for Artists changelog" (market, daily)
       - "DDEX ERN spec" (ddex, weekly)
       - "DistroKid pricing page" (competitor, weekly)
       - "Mavin Records press" (prospect, daily)
       List with name, type, and cadence. Leave empty to add later.

    2. **Default research depth** — what depth should new agent-run reports use
       by default?
       Options: brief · standard · deep
       Default: standard
       (brief = summary only; standard = full with sources; deep = multi-source
       synthesis + personas + competitive mapping)

    3. **Owner** — who is the primary human owner for research items?
       Default: current operator (e.g. nedjamez@royalti.io)
       Agent-run items show `⚙ research-agent` as owner; human-authored items
       show the configured owner.

    4. **Research types** — which research types are active for this project?
       Options: persona · competitor · prospect · market · ddex
       Default: all five enabled.

    5. **Stale thresholds** — how many days before a research note is flagged
       as stale per stage?
       Defaults:
       - draft: 14 days
       - review: 7 days
       - validated: 30 days
       Adjust any values before confirming.

    6. **Source stale thresholds** — how many days past cadence before a
       monitored source is flagged stale?
       Defaults:
       - daily cadence: signal at 1d, stale at 2d
       - weekly cadence: signal at 5d, stale at 7d
       - monthly cadence: signal at 21d, stale at 30d

    7. **Sweep schedule** — when should the research-sweep run automatically?
       Default: weekday mornings at 08:00 (`0 8 * * 1-5`).

    Present the full draft config in chat before writing. Do NOT write files
    until the operator explicitly approves.

    On approval write:

    **${CLAUDE_PROJECT_DIR}/.atelier/skill-research/manifest.json**
    ```json
    {
      "skill": "skill-research",
      "template_version": 1,
      "configured_at": "<ISO-8601>",
      "settings": {
        "monitored_sources": [],
        "default_depth": "standard",
        "owner": "nedjamez",
        "research_types": ["persona", "competitor", "prospect", "market", "ddex"],
        "stale_thresholds": {
          "draft": 14,
          "review": 7,
          "validated": 30
        },
        "source_stale_thresholds": {
          "daily": 2,
          "weekly": 7,
          "monthly": 30
        },
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
    - ".atelier/skill-research/manifest.json"
---

# action: setup

> **WP-22a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

The `setup` lifecycle action for skill-research. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8).

Setup localises the skill per project by confirming the monitored sources, cadences,
default research depth, owner, research types, stale thresholds, and sweep schedule
in a dock-chat conversation (D-02 — setup-in-chat pattern). It then writes the
project-local instance file at `${CLAUDE_PROJECT_DIR}/.atelier/skill-research/manifest.json`.

### Modes

Both `ai_infer` and `interview` are supported (`SetupMode`). The `run.prompt`
implements `ai_infer`; the shell can invoke `interview` mode with scripted
questions when the repo context is sparse.

### Instance file written

`manifest.json` (WP-06 lifecycle) — the skill instance config with:
- `monitored_sources` — list of external sources to track (name, type, cadence)
- `default_depth` — default research depth for new agent-run reports
- `owner` — primary human owner for research items
- `research_types` — active research types for this project
- `stale_thresholds` — per-stage stale day thresholds used by `research-sweep`
- `source_stale_thresholds` — per-cadence stale day thresholds for monitored sources
- `sweep_cron` — the schedule for `research-sweep` (default weekday 08:00)

### Pipeline-stages convention (R-04)

`setup` confirms the **stage enum** per the Pipeline-stages convention
(`06-skill-action-contract.md §Pipeline-stages`). The research stage enum is:
`draft → review → validated` (terminal: `archived`).
The enum is fixed for this domain and not operator-configurable in v1 — the
operator configures stale thresholds and source cadences, not stage names.

### Capabilities

- `fs` — writes the instance file under `.atelier/skill-research/`.
- `chat` — the confirm-in-chat conversation (D-02). No `sqlite` needed —
  setup does not read `ikenga.db`.

**No DB reads or writes.** Setup is purely a project-config action.

### Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02, locked R9)
specify the chat surface for this action.
