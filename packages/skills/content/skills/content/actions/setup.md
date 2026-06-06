---
name: setup
description: Configure skill-content for the current project (channels, series, cadence). Writes .atelier/skill-content/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Content Pipeline Setup

    Configure skill-content for this project. Run in one of two modes:

    **ai_infer mode (default):** Examine the project context (README.md,
    .claude/CLAUDE.md, any existing .atelier/skill-content/manifest.json) to
    infer reasonable defaults, then confirm each value with the operator in chat
    before writing the instance file.

    **interview mode:** Walk the operator through the configuration questions
    one by one when the repo context is sparse or a fresh setup is required.

    ## Configuration questions (confirm or ask each)

    1. **Active channels** — which content channels are active for this project?
       Options: blog · newsletter · social · video
       Note: video is TRACKING ONLY — no production actions run in this skill.
       Default: blog, newsletter, social (video tracked but not produced here).

    2. **Series** — are there recurring series (e.g. "Monthly digest", "Deep dives")?
       List names, or leave empty for none. Example: ["Monthly digest", "Product updates"]

    3. **Publishing cadence** — how often does each channel publish?
       Default:
       - blog: weekly
       - newsletter: weekly
       - social: daily
       Adjust any values before confirming.

    4. **Stale thresholds** — how many days in a stage before a piece is flagged
       as stale in the pipeline-sweep? Defaults:
       - idea: 14 days
       - outline: 14 days
       - draft: 7 days
       - review: 7 days
       - scheduled overdue: 3 days past publish_date

    5. **Sweep schedule** — when should the pipeline-sweep run automatically?
       Default: weekday mornings at 09:00 (`0 9 * * 1-5`).

    Present the full draft config in chat before writing. Do NOT write files
    until the operator explicitly approves.

    On approval write:

    **${CLAUDE_PROJECT_DIR}/.atelier/skill-content/manifest.json**
    ```json
    {
      "skill": "skill-content",
      "template_version": 1,
      "configured_at": "<ISO-8601>",
      "settings": {
        "channels": ["blog", "newsletter", "social", "video"],
        "active_channels": ["blog", "newsletter", "social"],
        "video_tracking_only": true,
        "series": [],
        "cadence": {
          "blog": "weekly",
          "newsletter": "weekly",
          "social": "daily"
        },
        "stale_thresholds": {
          "idea": 14,
          "outline": 14,
          "draft": 7,
          "review": 7,
          "scheduled_overdue": 3
        },
        "sweep_cron": "0 9 * * 1-5"
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
    - ".atelier/skill-content/manifest.json"
---

# action: setup

> **WP-21a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

The `setup` lifecycle action for skill-content. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8).

Setup localises the skill per project by confirming the active channels, series,
publishing cadence, stale thresholds, and sweep schedule in a dock-chat
conversation (D-02 — setup-in-chat pattern). It then writes the project-local
instance file at `${CLAUDE_PROJECT_DIR}/.atelier/skill-content/manifest.json`.

### Modes

Both `ai_infer` and `interview` are supported (`SetupMode`). The `run.prompt`
implements `ai_infer`; the shell can invoke `interview` mode with scripted
questions when the repo context is sparse.

### Instance file written

`manifest.json` (WP-06 lifecycle) — the skill instance config with:
- `channels` — all channels known to the project (always includes `video`)
- `active_channels` — channels with active production (default excludes `video`)
- `video_tracking_only: true` — signals `video` is tracking-only (G-VIDEO-STACK)
- `series` — named recurring series for grouping and sweep context
- `cadence` — per-channel publish frequency for staleness context
- `stale_thresholds` — per-stage stale day thresholds used by `pipeline-sweep`
- `sweep_cron` — the schedule for `pipeline-sweep` (default weekday 09:00)

### Pipeline-stages convention (R-04)

`setup` confirms the **stage enum** per the Pipeline-stages convention
(`06-skill-action-contract.md §Pipeline-stages`). The content stage enum is:
`idea → outline → draft → review → scheduled` (terminal: `published`).
The enum is fixed for this domain and not operator-configurable in v1 — the
operator configures stale thresholds and cadence, not stage names.

### Capabilities

- `fs` — writes the instance file under `.atelier/skill-content/`.
- `chat` — the confirm-in-chat conversation (D-02). No `sqlite` needed —
  setup does not read `ikenga.db`.

**No DB reads or writes.** Setup is purely a project-config action.

### Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02, locked R9)
specify the chat surface for this action.
