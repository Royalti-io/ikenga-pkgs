# @ikenga/pkg-engine-noop

## 0.1.2

### Patch Changes

- Republish with `manifest.json` version synced to the npm version. Previous
  tarballs shipped a stale manifest version, so the shell recorded the old
  version after every update and re-offered the same update forever.
  (`@ikenga/pkg-tasks` also catches its npm version up to the manifest's 0.8.x
  line — npm history jumps 0.4.1 → 0.8.1.)

## 0.1.1

### Patch Changes

- [`1ea4d9d`](https://github.com/Royalti-io/ikenga-pkgs/commit/1ea4d9d6be7af9f1d938e0cb87bd7719b662b092) Thanks [@nedjamez](https://github.com/nedjamez)! - Test: exercise the publish→registry bridge end-to-end.

  No functional change. This patch bump publishes `@ikenga/pkg-engine-noop@0.1.1`
  and triggers `scripts/update-registry-index.mjs` for the first time, proving
  the changesets/action → npm → registry-index pipeline works.
