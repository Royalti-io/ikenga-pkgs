# @ikenga/skill-groundwork

A Claude Code skill that scaffolds and maintains a reusable
**research → design → plan → orchestrate → act** folder for any
non-trivial work — software features, marketing campaigns, org changes.

It drops a domain-agnostic spine (`00-README` · `01-plan` · `02/03`
research · `04-discussion` newest-first · `05-tracking` ·
`09-orchestration` · a standalone `artifact/board.html` plan-board) plus
stateless action-skills that augment the docs in place without clobbering
hand-written prose. Profile-driven: `software`, `general`, `content`, and
`design-system`.

## Install

```bash
# Global install (recommended — available across all projects)
npx skills add royalti-io/groundwork -g

# Project install (committed with your repo)
npx skills add royalti-io/groundwork
```

`npx skills add` resolves `skills/groundwork/SKILL.md` and symlinks it into
`~/.claude/skills/groundwork/`.

## Canonical source vs. this package

The **canonical source of truth is the standalone repo
[`royalti-io/groundwork`](https://github.com/royalti-io/groundwork)** — the
same repo `npx skills add royalti-io/groundwork` installs from. Edit the skill
there.

This directory (`ikenga-pkgs/packages/skills/groundwork/`) holds a
**generated copy** synced one-way from the canonical repo, purely so
`@ikenga/skill-groundwork` can be published to npm (Changesets, ADR-009).
Every synced file under `./skills/groundwork/` carries a `GENERATED` banner —
**never hand-edit it**; edit the canonical repo and re-sync.

Sync direction is one-way: **canonical repo → this package.**

- `pnpm sync:from-canonical` — shallow-clones `royalti-io/groundwork` and
  mirrors its `skills/groundwork/` into `./skills/groundwork/` (re-bannered to
  point at the canonical repo). Use `--src <dir>` to sync from a local
  checkout.

> This reverses the earlier `sync-from-dev` + `build-mirror` forward flow
> (workspace → this package → force-pushed mirror), per the source-of-truth
> flip. The standalone repo is canonical; the forward push retires.

## Portability

The skill's docs and the standalone board carry a few
**this-workspace-internal references** (`plans/studio` / `plans/groundwork`)
that are illustrative in a target project. See
[`skills/groundwork/PORTABILITY.md`](skills/groundwork/PORTABILITY.md) for the
full disclosure.

## License

[Apache-2.0](LICENSE). Copyright © 2026 Royalti.io.
