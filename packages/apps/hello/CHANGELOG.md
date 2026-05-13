# @ikenga/pkg-hello

## 0.1.0

### Minor Changes

- [`9c197ef`](https://github.com/Royalti-io/ikenga-pkgs/commit/9c197ef3399378f396654cae2cc03a05213a95d3) Thanks [@nedjamez](https://github.com/nedjamez)! - Add `@ikenga/pkg-hello` — a manifest-only pkg used to prove the registry
  install pipeline end-to-end. No UI, no sidecars, no MCP — installing it
  exercises every step from index fetch through kernel registration, and
  the registries all no-op cleanly because the manifest declares nothing.
