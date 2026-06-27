# @ikenga/skill-groundwork

A Claude Code skill that scaffolds and maintains a reusable
**research → design → plan → orchestrate → act** folder for any
non-trivial work — software features, marketing campaigns, org changes.

It drops a domain-agnostic spine (`00-README` · `01-plan` · `02/03`
research · `04-discussion` newest-first · `05-tracking` ·
`09-orchestration`) plus stateless action-skills that augment the docs in
place without clobbering hand-written prose. Profile-driven: `software`,
`general`, `content`, and `design-system`. Each plan also gets self-contained
HTML views — a **board** (`artifact/board.html`), a fully-offline file
**explorer** with search (`artifact/explorer.html`), and a cross-plan
**plans index** (`<plans-dir>/_index.html`).

## Install

```bash
# Global install (recommended — available across all projects)
npx skills add royalti-io/groundwork -g

# Project install (committed with your repo)
npx skills add royalti-io/groundwork
```

`npx skills add` resolves `skills/groundwork/SKILL.md` and symlinks it into
`~/.claude/skills/groundwork/`.

## Source of truth & sync (forward flow)

Per the locked 2026-05-21 publish decision (`plans/groundwork/11-publish-skill.md`),
there are three copies and the sync is **one-way forward**:

| Copy | Path | Role |
|---|---|---|
| **Dev source** (working copy) | `<ikenga-workspace>/.claude/skills/groundwork/` | What the workspace edits + dogfoods. **Edit here.** |
| **Canonical release** (this package) | `ikenga-pkgs/packages/skills/groundwork/` | ADR-009 home, Changesets-versioned. Synced FROM dev. |
| **Published mirror** | [`royalti-io/groundwork`](https://github.com/royalti-io/groundwork) | The `npx skills add` install surface. Built FROM this package. |

Every synced file under `./skills/groundwork/` carries a `GENERATED` banner —
**never hand-edit it**; edit the dev source and re-run the sync.

- `pnpm sync:from-dev` — copies the dev source `.claude/skills/groundwork/` →
  `./skills/groundwork/` (re-bannered; generates `PORTABILITY.md`). Use
  `--src <dir>` to point at a specific dev checkout.
- `pnpm build:mirror` — emits the standalone `royalti-io/groundwork` mirror
  tree (package.json + README + install.sh + `skills/groundwork/`) to
  `./dist-mirror` for review before pushing.

> Restored the forward flow after the `sync-from-canonical` reversal (PR #24)
> was found to rest on a fabricated source-of-truth sign-off. The dev source is
> canonical; this package and the mirror are generated from it.

## Portability

The skill's docs and the standalone board carry a few
**this-workspace-internal references** (`plans/studio` / `plans/groundwork`)
that are illustrative in a target project. See
[`skills/groundwork/PORTABILITY.md`](skills/groundwork/PORTABILITY.md) for the
full disclosure.

## License

[Apache-2.0](LICENSE). Copyright © 2026 Royalti.io.
