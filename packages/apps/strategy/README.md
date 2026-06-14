# com.ikenga.strategy

Strategy domain surface for the Ikenga desktop. OKRs (board + list) · Cycles · Reviews.

The steering / governance surface: C-level cycles, OKRs, plan-validation and retrospectives run as dispatched agent actions — typed (`confirm`), scheduled (`silent` · metric auto-sync), or run-then-sign-off (`approve` · countersign, GA checklist). Objectives carry key results with progress fed from the finance + sales domains.

## Area enum (OKR board columns)

The strategy domain owns the `strategy_objectives.area` TEXT column. Values match the board column dimension:

| Area | Dot colour (inline on `.kb-col-dot`) |
|---|---|
| `Company` | `--primary` |
| `Growth` | `--achievement` |
| `Product` | `--systemic` |
| `Finance` | `--live` |

Any objective whose `area` falls outside this enum renders as its own visible column (tolerant `stagesWithExtras` grouping) — it is never silently dropped.

## ux_mode enum

| Mode | Meaning | Dot colour |
|---|---|---|
| `confirm` | Operator must confirm the agent action | `--achievement` |
| `silent` | Agent acts autonomously (e.g. nightly reconcile) | `--fg-faint` |
| `approve` | Operator must countersign before the action fires | `--primary` |

## Migration

`0054_strategy_domain.sql` — creates the three strategy-domain tables (STRICT, no FK, soft TEXT links):

- `strategy_objectives` — one row per OKR objective (id, title, area, cycle_id soft link, overall_pct, owner, ux_mode, next_action, created_at)
- `strategy_key_results` — KR rows per objective (id, objective_id soft link, label, pct, is_low, is_mid)
- `strategy_cycles` — quarterly planning cycles (id, name, start_date, end_date, status, objective_count, kr_count, avg_pct)

Until these are seeded, the board renders from real `strategic_initiatives` (grouped by `ties_to_goal` for the area) and the Reviews view from real `review_items` (`content_type = 'strategy'`).

## Views

| View | URL param | Description |
|---|---|---|
| OKRs — board | `?view=0` (default, `pipeMode=board`) | `.kb-col` columns per area; `.okr-*` KR bars + overall ring; `.kb-col-agg` (count + avg %); seg toggle for list |
| OKRs — list | `?view=0` + seg toggle | Objective `.pl-row`s grouped by area; `.pane-split` list + `.pl-detail` panel |
| Cycles | `?view=1` | `.fc-kpi` cells + `.st-cycle-row` cards per quarter |
| Reviews | `?view=2` | `.fc-kpi` cells + `.st-mv-table` of review cadence rows |

The Board/List seg appears in the side-menu only when `activeView === 0`. Filter groups dim (`.nav-group.is-dim`) on Cycles / Reviews.

## CSS naming

- Kit classes (from `@ikenga/tokens` app-kit): `.frame*` · `.pane-split` · `.pl-*` · `.kb-*` · `.okr-*` · `.kb-col-agg` · `.nav-group[data-kind]` · `.atelier-state.is-*` · `.btn*` · `.seg*`
- Domain residue (`.st-*` + small shared dots/chips): `.st-mv-wrap` · `.fc-kpi*` · `.st-cycle-row` · `.st-prog` · `.st-status-pill` · `.st-mv-table` · `.st-mv-badge` · `.ux-dot*` · `.next-chip` · `.stage-chip`

`.okr-bar` fill: default ≥66% (`--achievement`) · `.is-mid` 33–65% (`--systemic`) · `.is-low` <33% (`--danger`). Always paired with the `.pct` text — colour is never the sole carrier of at-risk status.

## Workspace tint

`data-workspace="settings"` — cool slate-blue active nav indicator; strategy is a configuration / governance surface, not a transactional one (distinct from the warm mail / outbox / content workspaces).

## Data sources

Tables declared in `manifest.json` `sqlite.tables`:
- `strategy_objectives` / `strategy_key_results` / `strategy_cycles` — created by `0054_strategy_domain.sql`
- `strategic_initiatives` — provisional OKR fallback (pre-existing), grouped by `ties_to_goal`
- `architecture_decisions` · `ideas_backlog` · `feature_score_history` — strategy-supporting reads (pre-existing)
- `review_items` — Reviews view source (pre-existing), filtered to `content_type = 'strategy'`
