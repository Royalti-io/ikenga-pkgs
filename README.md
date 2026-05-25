# ikenga-pkgs

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discussions](https://img.shields.io/badge/community-discussions-5865F2.svg)](https://github.com/Royalti-io/ikenga-pkgs/discussions)

> The canonical home for first-party Ikenga packages — engines, MCP servers, mini-apps, and
> helpers — in one Apache-2.0 monorepo.

## What it is

Every first-party Ikenga package lives here
([ADR-009](https://github.com/Royalti-io/ikenga/blob/main/docs/adr/009-monorepo-pkgs-all-open.md)),
versioned and published with Changesets. It's a good place to read working examples of
each pkg archetype before authoring your own.

## Layout

```
packages/
  engine/       AI engine adapters (claude-code, noop, …)
  mcp/          MCP servers (iyke, …)
  apps/         User-facing iframe mini-apps (studio, tasks, …)
  connectors/   External-service adapters
  sidecars/     Long-lived headless processes
```

## Workflow

This monorepo uses [Changesets](https://github.com/changesets/changesets) for per-package
versioning and publish.

```bash
pnpm install
pnpm -r build
pnpm changeset            # author a changeset describing your change
git commit -am "feat: ..."
# Open PR; on merge to main, "Version Packages" PR opens.
# Merging that PR publishes all bumped packages to npm and updates the registry index.
```

Each PR that changes a package must include a `.changeset/*.md` (the
[changeset-bot](https://github.com/apps/changeset-bot) will nag you on PRs that don't).

## Registry

Published versions appear in the [ikenga-registry](https://github.com/Royalti-io/ikenga-registry)
within seconds of `pnpm changeset publish` completing, via the
`scripts/update-registry-index.mjs` step in the release workflow. The shell and
`ikenga` CLI both consume that registry for discovery and install.

## Links

- [`ikenga`](https://github.com/Royalti-io/ikenga) — the desktop shell that loads these
- [`ikenga-contract`](https://github.com/Royalti-io/ikenga-contract) — the manifest schema each pkg validates against

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
