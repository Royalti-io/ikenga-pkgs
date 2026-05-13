# Contributing to @ikenga/mcp-iyke

Thanks for considering a contribution. This package is small and the path from "good idea" to "merged PR" should be short.

## Scope

This MCP server is intentionally a thin wrapper around the iyke localhost HTTP API exposed by the Ikenga shell. It should:

- **Mirror** what the in-app server already exposes — not add new endpoints.
- **Stay generic** — no music-industry, business-domain, or vendor-specific code.
- **Stay small** — fewer dependencies, fewer abstractions, fewer surprises.

If your idea requires changes to the iyke HTTP server, open an issue against [Royalti-io/ikenga](https://github.com/Royalti-io/ikenga) first.

## Local setup

```bash
git clone https://github.com/Royalti-io/ikenga-pkg-mcp-iyke.git
cd ikenga-pkg-mcp-iyke
npm install        # installs deps including @ikenga/contract from npm
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit (faster, no emit)
```

To test against a local Ikenga shell, install Ikenga and run it; the MCP server reads `control.json` from the standard app-data path (`~/Library/Application Support/app.ikenga/control.json` on macOS, `$XDG_DATA_HOME/app.ikenga/control.json` on Linux, `%APPDATA%/app.ikenga/control.json` on Windows).

To wire the local build into Claude Code:

```bash
claude mcp add iyke-dev -s user -- node /path/to/ikenga-pkg-mcp-iyke/dist/index.js
```

## Pull requests

1. **Fork + branch.** Branch names like `fix/stale-control` or `feat/iyke-screenshot-pane`.
2. **One PR, one purpose.** Keep PRs small and focused.
3. **Add tests** when fixing a bug or adding behavior. We use the runtime test harness at [Royalti-io/ikenga](https://github.com/Royalti-io/ikenga) for end-to-end coverage; for pure logic in this repo, plain `node:test` is fine.
4. **Update the README** if you change the tool catalog, args, or behavior.
5. **Sign your commits** with the [Developer Certificate of Origin](https://developercertificate.org/) — append `Signed-off-by: Your Name <your@email>` to each commit message (`git commit -s` does this automatically). By signing, you confirm you have the right to contribute the code under Apache 2.0.

## Code style

- TypeScript strict mode (already enforced by tsconfig).
- Prefer named exports over default exports.
- Imports: stdlib first, then external, then local (`./*`).
- Use `.js` extensions in import paths even from `.ts` source — that's what the NodeNext module resolver expects and is what gets emitted.
- No `any` without a `// reason: ...` comment justifying it.
- Errors thrown to MCP clients should be `McpError` (from `@modelcontextprotocol/sdk/types.js`) for protocol errors, and plain `Error` for runtime failures (the dispatcher converts those to `isError: true` results).

## Releasing (maintainers only)

```bash
# 1. Bump version in package.json (semver: patch / minor / major)
npm version patch  # or minor / major

# 2. Build + verify
npm run build
npm pack --dry-run  # confirm files list is correct

# 3. Publish to npm (must be logged in to a Royalti-io account)
npm publish

# 4. Push tag + commits
git push --follow-tags
```

The `prepublishOnly` script runs `npm run build` automatically — fresh dist/ ships every time.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). We follow Contributor Covenant 2.1.
