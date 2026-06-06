# com.ikenga.sales

Sales domain surface for the Ikenga desktop. Pipeline (list + kanban) · Forecast · Won.

## Stage enum

Per the R-04 Pipeline-stages convention (`plans/atelier/06-skill-action-contract.md §Pipeline-stages`), the sales domain owns the `sales_deals.stage` TEXT column. Values are lowercase kebab:

| Stage | Type | Description |
|---|---|---|
| `lead` | open | Unqualified opportunity |
| `qualified` | open | Fit confirmed; demo/scoping in progress |
| `proposal` | open | Proposal or MSA in flight |
| `negotiation` | open | Terms under negotiation |
| `closing` | open | Signed / countersign pending |
| `won` | **terminal** | Deal closed-won |
| `lost` | **terminal** | Deal closed-lost |

The Won view (`?view=2`) queries `sales_deals WHERE stage = 'won'`.
There is no `sales_deals_won` table — won deals are rows on `sales_deals` filtered by stage.

## Migration

`0043_sales_domain.sql` — adds app-layer columns to `sales_deals`:

```sql
ALTER TABLE sales_deals ADD COLUMN title TEXT;
ALTER TABLE sales_deals ADD COLUMN owner TEXT;
ALTER TABLE sales_deals ADD COLUMN next_action TEXT;
ALTER TABLE sales_deals ADD COLUMN next_action_mode TEXT;   -- confirm | silent | approve
ALTER TABLE sales_deals ADD COLUMN win_probability REAL;
```

No stored `age_days` — derived client-side from `days_in_stage` (existing column) or `stage_entered_date`.

## Views

| View | URL param | Description |
|---|---|---|
| Pipeline — list | `?view=0` (default) | Deal rows grouped by stage; `.ip-split` list + detail |
| Pipeline — kanban | `?view=0` + seg toggle | `.kb-col` columns per stage; drag to advance |
| Forecast | `?view=1` | KPI cells + weighted funnel + expected-close bar chart |
| Won | `?view=2` | KPI cells + table of `stage='won'` deals |

## CSS naming

- Kit classes: `.frame*` · `.dense-row--pipeline` · `.ip-split*` · `.split-row*` · `.kb-*` · `.nav-group[data-kind]` · `.atelier-state.is-*` · `.tag` · `.chip` · `.btn*` · `.seg*`
- Domain residue (`.sl-*`): `.sl-forecast-*` · `.sl-kpi-*` · `.sl-funnel-*` · `.sl-month-*` · `.sl-won-*` · `.sl-won-badge` · `.sl-won-amt`

## Workspace tint

`data-workspace="sessions"` — warm amber-ochre active nav indicator; differentiates from `mail` (amber) and `outbound` (red-orange).

## Data sources

Tables declared in `manifest.json` `sqlite.tables`:
- `sales_deals` — primary pipeline; app-layer columns added by `0043_sales_domain.sql`
- `sales_activities` — deal activity timeline in the detail pane
- `sales_forecasts` — Forecast view KPIs (falls back to client-side aggregation)
- `sales_lead_scores` — optional deal row score display
- `contacts` — resolves contact name/email for deal rows
