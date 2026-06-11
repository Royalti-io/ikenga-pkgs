# @ikenga/pkg-sales

## 0.2.0

### Minor Changes

- [`dea9abb`](https://github.com/Royalti-io/ikenga-pkgs/commit/dea9abbe2fc54c9f9ae190b7ed12208ecbbded5a) Thanks [@nedjamez](https://github.com/nedjamez)! - WP-18b: Add com.ikenga.sales domain pkg — Pipeline (list+kanban) / Forecast / Won views.

  - No-build srcdoc iframe pkg at packages/apps/sales/
  - Views: Pipeline (?view=0; list default + kanban toggle) / Forecast (?view=1) / Won (?view=2)
  - Kit classes from the start: .frame* · .dense-row--pipeline · .ip-split* · .split-row* · .kb-* · .nav-group[data-kind] · .atelier-state.is-_ · .btn_ · .seg\*
  - Domain residue (.sl-\*): Forecast KPI/funnel/month-chart layout; Won KPI/table
  - Deterministic CSS vendoring via scripts/build.mjs (tokens → app-kit → sales-css)
  - Stage enum: lead → qualified → proposal → negotiation → closing → won|lost
  - Fixture data: 8 open deals ($506K) + 6 won deals ($312K) per screen doc §1
  - Mock contract 1: app-layer fallbacks until 0043_sales_domain migration applies
  - Depends on: @ikenga/tokens@^0.3.0, 0043_sales_domain.sql (shell WP-18b-schema)

### Patch Changes

- [#18](https://github.com/Royalti-io/ikenga-pkgs/pull/18) [`913f78f`](https://github.com/Royalti-io/ikenga-pkgs/commit/913f78f1dbf289868eb3de8c653d291131e99ac4) Thanks [@nedjamez](https://github.com/nedjamez)! - Wire `requires: [{ kind: "skill", name: "skill-<domain>" }]` into the finance / sales / outbound / content / tasks pane manifests so each pane's in-shell action bar surfaces its domain skill's actions via `list_skill_actions` → the Ọba store. Extends WP-25's mail-only proof to all six domain panes.
