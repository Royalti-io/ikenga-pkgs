---
name: setup
description: Configure skill-pa for the current project (inbox labels, triage buckets, send policy). Writes .atelier/skill-pa/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # PA Setup

    TODO (WP-12): Infer project PA configuration from repo context
    (infer_sources: package.json, README.md). Draft candidate settings
    (inbox_labels, triage_buckets, send_policy, briefing_schedule) and
    present each for operator confirmation in chat (D-02). On confirmation
    write .atelier/skill-pa/manifest.json with template_version: 1.
    Do NOT clobber an existing file — detect older template_version and
    run the migrate path forward instead.
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
    - ".atelier/skill-pa/manifest.json"
---

# action: setup

> **WP-12 stub.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). The prose body lands in WP-12.

## What this action does (intent)

The `setup` lifecycle action for skill-pa. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8). It declares no `inputs_schema` (the adapter
falls back to the empty-object JSON-Schema). Optional — skill-pa functions with
defaults if setup has not been run. When run, it:

1. Reads `infer_sources` to draft a candidate config.
2. Presents each setting for operator confirmation **in chat** (D-02 — not a form).
3. Writes (or migrates) `${CLAUDE_PROJECT_DIR}/.atelier/skill-pa/manifest.json`.

**Instance file shape** (see `lib/state.md` §Setup instance file for full spec):

```json
{
  "skill": "skill-pa",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "inbox_labels": ["INBOX"],
    "triage_buckets": ["reply-now", "delegate", "archive", "snooze"],
    "send_policy": "approve-before-send",
    "briefing_schedule": "07:00"
  }
}
```

**Capabilities:**
- `fs` — writes the `.atelier/skill-pa/manifest.json` instance file.
- `chat` — the confirm-in-chat conversation (D-02). No `sqlite` needed — setup
  does not read `ikenga.db`.

**No DB reads or writes.** `setup` is purely a project-config action.
