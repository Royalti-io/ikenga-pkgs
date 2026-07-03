---
"@ikenga/pkg-mail": minor
"@ikenga/pkg-tasks": patch
"@ikenga/pkg-sales": minor
"@ikenga/pkg-strategy": minor
"@ikenga/pkg-content": minor
"@ikenga/pkg-research": minor
"@ikenga/pkg-finance": minor
"@ikenga/pkg-outbound": minor
---

Parity sweep (atelier-parity WP-14..17): every dead affordance surfaced by the
2026-07-02 review is wired or honestly disabled. Highlights — mail: 5 sidebar
items live (group-by-person/tag, snoozed view, deal/overdue facets) + thread-
collapse rail + Cmd-F; sales: dispatch-wired approve/confirm buttons, working
facets, error Retry, forecast bar fix; strategy: provenance-aware drag (fallback
rows read-only), real progress_pct, authored is_low/is_mid honored, data-model
aggregates; content: dispatch-seeded creation + calendar/published drill-downs;
research: personas off real rows, hand-to-sales never silently no-ops, fit/tags
rendered; finance: Paystack splits panel (+ manifest table grant), ledger-
computed P&L; outbound: editable newsletter subject/preheader with flush-before-
approve, preview toolbar + anti-pattern list, SVG sent charts (3 channels),
bulk-select + date sections + J/K nav on cross-channel approvals, deliverability
strip, and an actionable notice steering dead in-pane paActions writes to the
working /outbox/approvals surface.
