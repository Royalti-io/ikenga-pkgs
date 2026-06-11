# @ikenga/pkg-outbound

## 0.2.0

### Minor Changes

- [`931707d`](https://github.com/Royalti-io/ikenga-pkgs/commit/931707d2c0835321b4fd0347c1d59894ba6e41e4) Thanks [@nedjamez](https://github.com/nedjamez)! - Add `com.ikenga.outbound` domain pkg (WP-19b) — Channels sidebar (Email / Newsletter / Sequences / Social) with approval queue, schedule, and sent views per channel; cooling-period chip; quality score display; A/B variant selector; by-agent filter facets; four `.atelier-state` variants; `host.dbQuery` reads from seven `ikenga.db` tables; `host.dbExec` approve/reject writes; deterministic CSS vendoring via `scripts/build.mjs`.

### Patch Changes

- [#18](https://github.com/Royalti-io/ikenga-pkgs/pull/18) [`913f78f`](https://github.com/Royalti-io/ikenga-pkgs/commit/913f78f1dbf289868eb3de8c653d291131e99ac4) Thanks [@nedjamez](https://github.com/nedjamez)! - Wire `requires: [{ kind: "skill", name: "skill-<domain>" }]` into the finance / sales / outbound / content / tasks pane manifests so each pane's in-shell action bar surfaces its domain skill's actions via `list_skill_actions` → the Ọba store. Extends WP-25's mail-only proof to all six domain panes.
