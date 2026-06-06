---
"@ikenga/pkg-finance": minor
---

WP-20b: Add com.ikenga.finance domain pkg — Overview / Transactions / Receivables / Inter-Company / Reports.

- No-build srcdoc iframe pkg at packages/apps/finance/
- Views: Overview (KPI strip + waterfall + treemap + alert strip) / Transactions (ledger + confirm/dispute) / Receivables (aging buckets + invoice table) / Inter-Company (pair queue) / Reports (period summary, export deferred WP-23)
- Kit classes from the start: .frame* · .stat-card.is-warn/.is-danger · .frame-tab* · .pane-toolbar* · .pane-filterbar* · .badge* · .atelier-state.is-* · .btn*
- Domain residue (.fin-*): KPI internals · runway gauge SVG · treemap · alert strip · ledger table · aging buckets · inter-company queue · entity-switch · btn-confirm/btn-dispute
- Runway warn at < 12 mo threshold; .is-danger at < 6 mo
- Deterministic CSS vendoring via scripts/build.mjs (tokens → app-kit → finance-css)
- Mock contract 1: alert-strip seeded from overdue receivables + unreconciled inter-company entries until 0046 migration lands
- Owns migration 0046_finance_domain.sql — finance_alerts table (STRICT, no FK, soft TEXT links)
- data-workspace="files" (dusty warm); tracked gap until dedicated finance tint extended in @ikenga/tokens
- Depends on: @ikenga/tokens@^0.3.0, 0046_finance_domain.sql (shell WP-20b-schema)
