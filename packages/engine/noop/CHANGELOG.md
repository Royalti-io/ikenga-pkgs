# @ikenga/pkg-engine-noop

## 0.1.1

### Patch Changes

- [`1ea4d9d`](https://github.com/Royalti-io/ikenga-pkgs/commit/1ea4d9d6be7af9f1d938e0cb87bd7719b662b092) Thanks [@nedjamez](https://github.com/nedjamez)! - Test: exercise the publish→registry bridge end-to-end.

  No functional change. This patch bump publishes `@ikenga/pkg-engine-noop@0.1.1`
  and triggers `scripts/update-registry-index.mjs` for the first time, proving
  the changesets/action → npm → registry-index pipeline works.
