# @ikenga/mcp-devin

## 0.2.1

### Patch Changes

- [#59](https://github.com/ikenga-hq/ikenga-pkgs/pull/59) [`81ff661`](https://github.com/ikenga-hq/ikenga-pkgs/commit/81ff6614f9998ef39c7bd06493aa360cd75de891) Thanks [@nedjamez](https://github.com/nedjamez)! - Move MCP server identities to the `dev.ikenga/*` namespace, authenticated
  against the `ikenga.dev` domain rather than a GitHub org name. The previous
  `io.github.Royalti-io/*` identities were invalidated by the move to the
  `ikenga-hq` org; a domain-based namespace cannot be broken the same way again.

## 0.2.0

### Minor Changes

- [`375fa8d`](https://github.com/Royalti-io/ikenga-pkgs/commit/375fa8da4afbfec550be01b25aeafc679ff6decb) Thanks [@nedjamez](https://github.com/nedjamez)! - Implement robust task ledger, concurrency limits, atomic writes, boot reconciliation, and process signal handling for Devin MCP tool delegation.
