# @ikenga/pkg-finance

## 0.2.0

### Minor Changes

- [#18](https://github.com/Royalti-io/ikenga-pkgs/pull/18) [`913f78f`](https://github.com/Royalti-io/ikenga-pkgs/commit/913f78f1dbf289868eb3de8c653d291131e99ac4) Thanks [@nedjamez](https://github.com/nedjamez)! - WP-20b: Add com.ikenga.finance domain pkg — Overview / Transactions / Receivables / Inter-Company / Reports.

  - No-build srcdoc iframe pkg at packages/apps/finance/
  - Views: Overview (KPI strip + waterfall + treemap + alert strip) / Transactions (ledger + confirm/dispute) / Receivables (aging buckets + invoice table) / Inter-Company (pair queue) / Reports (period summary, export deferred WP-23)
  - Kit classes from the start: .frame* · .stat-card.is-warn/.is-danger · .frame-tab* · .pane-toolbar* · .pane-filterbar* · .badge* · .atelier-state.is-* · .btn\*
  - Domain residue (.fin-\*): KPI internals · runway gauge SVG · treemap · alert strip · ledger table · aging buckets · inter-company queue · entity-switch · btn-confirm/btn-dispute
  - Runway warn at < 12 mo threshold; .is-danger at < 6 mo
  - Deterministic CSS vendoring via scripts/build.mjs (tokens → app-kit → finance-css)
  - Mock contract 1: alert-strip seeded from overdue receivables + unreconciled inter-company entries until 0046 migration lands
  - Owns migration 0046_finance_domain.sql — finance_alerts table (STRICT, no FK, soft TEXT links)
  - data-workspace="files" (dusty warm); tracked gap until dedicated finance tint extended in @ikenga/tokens
  - Depends on: @ikenga/tokens@^0.3.0, 0046_finance_domain.sql (shell WP-20b-schema)

### Patch Changes

- [#18](https://github.com/Royalti-io/ikenga-pkgs/pull/18) [`913f78f`](https://github.com/Royalti-io/ikenga-pkgs/commit/913f78f1dbf289868eb3de8c653d291131e99ac4) Thanks [@nedjamez](https://github.com/nedjamez)! - Wire `requires: [{ kind: "skill", name: "skill-<domain>" }]` into the finance / sales / outbound / content / tasks pane manifests so each pane's in-shell action bar surfaces its domain skill's actions via `list_skill_actions` → the Ọba store. Extends WP-25's mail-only proof to all six domain panes.

- [#18](https://github.com/Royalti-io/ikenga-pkgs/pull/18) [`913f78f`](https://github.com/Royalti-io/ikenga-pkgs/commit/913f78f1dbf289868eb3de8c653d291131e99ac4) Thanks [@nedjamez](https://github.com/nedjamez)! - fix(finance): pane content now scrolls and the sidebar entity filter works.

  - **Scroll**: add `height: 100%` to the root `.frame`. It mounts directly in `#root` without the `.frame-pane-slot` wrapper that supplies `flex: 1`, so the `.frame` had no bounded height and `.frame-body`'s `overflow-y: auto` never engaged — content overflowed the fixed `#root` and was clipped. Mirrors the working sales pane.
  - **Filter**: the `activeFeature` effect only handled view ids and ignored the sidebar `ent-*` Accounts facet items, so the sidebar entity filter was dead. Route `ent-{all,royalti,dixtrit,personal}` → `setEntity`, and reflect the selected entity as the active menu item in `buildFinanceMenu`.
