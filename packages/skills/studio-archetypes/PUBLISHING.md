# PUBLISHING — @ikenga/studio-archetypes

> **The per-skill mirror model this file described is retired.** It is kept as
> a pointer because sibling `held-changesets/README.md` files still link here.

Skills are distributed through the **marketplace** at
[`ikenga-hq/marketplace`](https://github.com/ikenga-hq/marketplace), which
installs each skill straight from this monorepo (`source: git-subdir` →
`ikenga-hq/ikenga-pkgs`, `path: packages/skills/<name>`). There is no
separate mirror repo to create, and no 3-copy sync to run.

## To publish a skill

Add an entry to `.claude-plugin/marketplace.json` in that repo. Users then run:

```
/plugin marketplace add ikenga-hq/marketplace
/plugin install <name>@ikenga
```

## What changed

The old runbook told you to `gh repo create ikenga-hq/<name> --public` and
push a generated mirror. Following it now creates a repo the marketplace makes
unnecessary. Only **three** mirror repos still exist, and no new ones are being
created:

| Mirror | Why it stays |
|---|---|
| `ikenga-hq/groundwork` | `npx skills add` line published in blog posts and on ikenga.dev |
| `ikenga-hq/ikenga-artifact-builder` | same |
| `ikenga-hq/ikenga-contribute` | same |

Business-ops skills (`finance`, `sales`, `pa`, `mail`, `outbound`,
`strategy`, `query`, `tasks`, `content`, `research`) are **not** in the
marketplace at all — they read `ikenga.db` through `host.dbQuery` and need a
running shell, so they ship with it.

Rationale: `plans/2026-08-23-ikenga-skill-marketplace/` in the workspace repo.
Retirement tracked as ikenga-pkgs#66.
