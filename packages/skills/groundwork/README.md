# @ikenga/skill-groundwork

A Claude Code skill that scaffolds and maintains a reusable
**research → design → plan → orchestrate → act** folder for any
non-trivial work — software features, marketing campaigns, org changes.

It drops a domain-agnostic spine (`00-README` · `01-plan` · `02/03`
research · `04-discussion` newest-first · `05-tracking` ·
`09-orchestration` · a standalone `artifact/board.html` plan-board) plus
stateless action-skills that augment the docs in place without clobbering
hand-written prose. Profile-driven: `software` (rich default) and
`general` (lean, non-code).

## Install

```bash
# Global install (recommended — available across all projects)
npx skills add royalti-io/groundwork -g

# Project install (committed with your repo)
npx skills add royalti-io/groundwork
```

`npx skills add` resolves `skills/groundwork/SKILL.md` and symlinks it into
`~/.claude/skills/groundwork/`.

## Canonical source vs. install surface

This directory (`ikenga-pkgs/packages/skills/groundwork/`) is the
**canonical, Changesets-versioned source** per ADR-009. The
`npx skills add royalti-io/groundwork` install surface is a thin **mirror
repo** generated from here. The dev/working copy lives in this workspace
at `.claude/skills/groundwork/`.

Sync direction is one-way: **dev source → this package → mirror repo.**

- `pnpm sync:from-dev` — copies `.claude/skills/groundwork/` into
  `./skills/groundwork/` (every synced file carries a `GENERATED` banner —
  edit the dev source, never the synced copy).
- `pnpm build:mirror` — emits the standalone mirror-repo tree (the thing
  pushed to `royalti-io/groundwork`).

## Portability

The skill's docs and the standalone board carry a few
**this-workspace-internal references** (`plans/studio` / `plans/groundwork`)
that are illustrative in a target project. See
[`skills/groundwork/PORTABILITY.md`](skills/groundwork/PORTABILITY.md) for the
full disclosure.

## License

[Apache-2.0](LICENSE). Copyright © 2026 Royalti.io.
