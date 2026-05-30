---
name: skill-core
description: |
  skill-core — the generic identity hub for the Ikenga skill graph. Generates
  and maintains a project's identity (brand, founder voice, product, ICP) in
  `.atelier/skill-core/manifest.json` via the `setup` action, and is the single
  `depends_on` target every domain skill (tasks, mail, sales, outbound, finance,
  content, research, strategy) declares (the G-04 one-way star).

  TRIGGER when the user asks to set up / configure a project's identity for the
  Atelier skills, or runs `setup` for skill-core. Runs as a Chi conversation in
  the dock.

  DO NOT TRIGGER for any domain work (briefing, triage, sends, finance, content,
  etc.) — those belong to the domain skills, which depend on this one.
depends_on: []
allowed-tools: Read, Write, Skill
---

# skill-core — the lean identity hub

**This file is a router.** skill-core is the hub of the skill graph: every
domain skill declares `depends_on: ['skill-core']` (a one-way star, G-04,
lint-enforced in `06-skill-action-contract.md §5`). skill-core itself depends on
nothing (`depends_on: []`).

> **Lean hub (founder decision, 2026-05-30).** skill-core ships exactly **one**
> action — `setup`, the per-project identity generator. It carries **no** domain
> logic, **no** shared lore / editorial bundle, and **no** shared query /
> pipeline base. Those are deferred (R-03 query-collapse, R-04 pipeline base).
> The single job of this package is to resolve the `depends_on: ['skill-core']`
> edge and to localise project identity that the domain skills read.

---

## Purpose (one line)

Generate and maintain the per-project identity instance file
(`.atelier/skill-core/manifest.json`) that the domain skills localise against.

---

## Actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Infer the project's identity (brand, founder voice, product, ICP) and write `.atelier/skill-core/manifest.json`. |

The `setup` action conforms to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts` and is the worked example B in
`06-skill-action-contract.md §8`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "set up the project", "configure identity", "setup skill-core", "who are we" | [`actions/setup.md`](actions/setup.md) | `ai_infer` (draft from repo) or `interview` mode; confirm in chat; write `.atelier/skill-core/manifest.json` |

---

## What skill-core does NOT do

- **No domain logic** — no briefing, triage, sends, finance, content, research,
  or strategy actions. Those live in the domain skills.
- **No shared lore / editorial bundle** — deferred. skill-core is identity only.
- **No shared query / pipeline base** — deferred (R-03 / R-04).
- **No DB reads or writes** — `setup` writes only the `.atelier/` project-config
  instance file via the host `fs` capability. No `sqlite`, no Supabase.

---

## Critical files

```
core/
├── SKILL.md                  ← you are here (router only; the hub)
└── actions/
    └── setup.md              ← the per-project identity generator (the only action)
```
