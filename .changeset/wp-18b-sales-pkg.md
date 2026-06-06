---
"@ikenga/pkg-sales": minor
---

WP-18b: Add com.ikenga.sales domain pkg — Pipeline (list+kanban) / Forecast / Won views.

- No-build srcdoc iframe pkg at packages/apps/sales/
- Views: Pipeline (?view=0; list default + kanban toggle) / Forecast (?view=1) / Won (?view=2)
- Kit classes from the start: .frame* · .dense-row--pipeline · .ip-split* · .split-row* · .kb-* · .nav-group[data-kind] · .atelier-state.is-* · .btn* · .seg*
- Domain residue (.sl-*): Forecast KPI/funnel/month-chart layout; Won KPI/table
- Deterministic CSS vendoring via scripts/build.mjs (tokens → app-kit → sales-css)
- Stage enum: lead → qualified → proposal → negotiation → closing → won|lost
- Fixture data: 8 open deals ($506K) + 6 won deals ($312K) per screen doc §1
- Mock contract 1: app-layer fallbacks until 0043_sales_domain migration applies
- Depends on: @ikenga/tokens@^0.3.0, 0043_sales_domain.sql (shell WP-18b-schema)
