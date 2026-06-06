---
name: setup
description: Configure skill-tasks for the current project (roster of humans + agents). Writes .atelier/skill-tasks/roster.json and manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Tasks Roster Setup

    Infer the project's human team members and active agents from the project
    context (infer_sources: package.json, README.md, .claude/CLAUDE.md). Draft
    two lists:

    1. **humans** — team members who can own or be assigned tasks.
       Each entry: { value: <email-or-id>, label: <display-name> }.
    2. **agents** — Ikenga domain agents active in this project.
       Each entry: { id: <agent-id>, label: <display-name> }.
       Convention: agent ids end in `-agent` (e.g. `finance-agent`).

    Present the draft roster in chat for the operator to confirm, add, edit, or
    remove entries (D-02 — confirm in chat, not a form). Do NOT write files
    until the operator explicitly approves.

    On approval write two files:

    **${CLAUDE_PROJECT_DIR}/.atelier/skill-tasks/roster.json**
    ```json
    {
      "humans": [{ "value": "<id>", "label": "<name>" }, ...],
      "agents": [{ "id": "<agent-id>", "label": "<name>" }, ...]
    }
    ```
    Both arrays must be non-empty. If no agents are identifiable, ask the
    operator for at least one.

    **${CLAUDE_PROJECT_DIR}/.atelier/skill-tasks/manifest.json**
    ```json
    {
      "skill": "skill-tasks",
      "template_version": 1,
      "configured_at": "<ISO-8601>",
      "settings": {
        "sweep_cron": "30 */4 * * *",
        "sweep_lookback_days": 14,
        "close_after_days_done": 7
      }
    }
    ```

    Do NOT clobber an existing manifest.json — detect older template_version
    and run the migrate path forward instead (preserve operator-set settings,
    merge new keys with defaults). roster.json may be overwritten on re-run.
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
    - "package.json"
    - "README.md"
    - ".claude/CLAUDE.md"
    - ".atelier/skill-tasks/manifest.json"
---

# action: setup

> **WP-16 stub.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). The prose body lands in WP-16.

## What this action does (intent)

The `setup` lifecycle action for skill-tasks. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8).

This action **closes the WP-10 loop**: it produces the
`.atelier/skill-tasks/roster.json` file that the shell injects into the Tasks
pkg's `hostContext` as `hostContext.royaltiSuite.tasksRoster`. Once the shell
delivers this payload, `resolveRoster(hostContext)` in `assignees.js` returns
a live configured roster, populating the create-task owner picker and the
task-detail reassign dropdown with real team members and agents.

### Modes

Both `ai_infer` and `interview` are supported (`SetupMode`). The `run.prompt`
implements `ai_infer`; the shell can invoke `interview` mode with scripted
questions if the repo context is sparse.

### Instance files written

1. **`roster.json`** (WP-10 contract) — the payload for the Tasks pkg.
   Both `humans` and `agents` must be non-empty arrays or `resolveRoster`
   returns `null` and the static fallback stays active.
2. **`manifest.json`** (WP-06 lifecycle) — the skill instance config with
   sweep tuning parameters (`sweep_cron`, `sweep_lookback_days`,
   `close_after_days_done`).

### Capabilities

- `fs` — writes both instance files under `.atelier/skill-tasks/`.
- `chat` — the confirm-in-chat conversation (D-02). No `sqlite` needed —
  setup does not read `ikenga.db`.

**No DB reads or writes.** Setup is purely a project-config action.

### Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02, locked R9)
specify the chat surface for this action.
