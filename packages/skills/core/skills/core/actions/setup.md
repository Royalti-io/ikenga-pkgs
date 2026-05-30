---
name: setup
description: Infer the project's identity (brand, founder voice, product, ICP) and write .atelier/skill-core/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # skill-core Setup — project identity

    You are generating the project's **identity** — the shared foundation every
    Atelier domain skill localises against. Work as a Chi conversation in the
    dock (D-02): infer, then confirm each value with the operator before writing.

    1. Read the `infer_sources` (package.json, README.md, the site/landing copy,
       src/) and draft a candidate identity:
         - `brand`        — product / company name + one-line positioning.
         - `founder_voice` — tone, register, signature phrasings to write in.
         - `product`      — what it is, who ships it, the core value.
         - `icp`          — the ideal customer profile (who it's for, the job).
       Add `project_name` and `timezone` if discoverable.
    2. Present each drafted value in chat and let the operator confirm or edit.
       Do NOT write anything until the operator confirms.
    3. On confirmation write `${CLAUDE_PROJECT_DIR}/.atelier/skill-core/manifest.json`
       with `template_version: 1` and the confirmed `settings`.
    4. If a `.atelier/skill-core/manifest.json` already exists, do NOT clobber it —
       detect its `template_version` and run the migrate path forward
       (preserve operator-set `settings`).

    This is project-config only: no DB reads/writes, no Supabase, no network
    sends. The single side effect is the `.atelier/` instance file write.
triggers:
  - kind: manual
depends_on: []
requires_capabilities:
  - fs
  - chat
setup:
  mode: ai_infer
  template_version: 1
  infer_sources:
    - "package.json"
    - "README.md"
    - "src/"
    - ".atelier/skill-core/manifest.json"
---

# action: setup

> **The lean hub's one action.** The YAML frontmatter above is the action
> declaration (validates against `ActionFrontmatter`). This is the worked
> example B in `06-skill-action-contract.md §8` — the skill-core identity
> generator in `ai_infer` mode.

## What this action does (intent)

The `setup` lifecycle action for skill-core. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required; `domain` is
`skill-core` — the generic identity domain). It declares no `inputs_schema`
(the portability adapter falls back to the empty-object JSON-Schema). When run
it:

1. Reads `infer_sources` to draft a candidate **identity** (brand, founder
   voice, product, ICP).
2. Presents each value for operator confirmation **in chat** (D-02 — not a form).
3. Writes (or migrates) `${CLAUDE_PROJECT_DIR}/.atelier/skill-core/manifest.json`.

Because skill-core is the **hub**, this identity file is the foundation each
domain skill's own `setup` reads when it localises (e.g. `skill-mail` setup can
adopt the founder voice; `skill-content` setup can adopt the brand + ICP).

**Instance file shape:**

```json
{
  "skill": "skill-core",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "project_name": "acme-records",
    "timezone": "Europe/London",
    "brand": "Acme Records — independent label tooling",
    "founder_voice": "plain, direct, a little dry; no hype",
    "product": "a catalog + royalties workspace for small labels",
    "icp": "1–3 person indie labels managing 50–500 releases"
  }
}
```

**Capabilities:**
- `fs` — writes the `.atelier/skill-core/manifest.json` instance file.
- `chat` — the confirm-in-chat conversation (D-02). **No `sqlite`** — setup does
  not read or write `ikenga.db`.

**No DB reads or writes. No Supabase. No network.** `setup` is purely a
project-config action (0 CRUD). On a future skill-core upgrade that ships
`template_version: 2`, `setup` migrates the older instance file forward rather
than clobbering operator-set `settings`.
