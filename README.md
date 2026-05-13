# ikenga-pkgs

Open-source packages for the [Ikenga](https://github.com/Royalti-io/ikenga) workspace.

Per [ADR-009](https://github.com/Royalti-io/ikenga/blob/main/docs/adr/009-monorepo-pkgs-all-open.md) all packages here ship under **Apache-2.0**.

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

## License

[Apache-2.0](LICENSE).
