# com.ikenga.finance

Finance domain pkg for the Ikenga desktop. Provides the accounting workspace for the multi-entity Royalti.io / Dixtrit.media / Personal money universe.

## Views

| View | Route | Description |
|---|---|---|
| **Overview** | `overview` | KPI strip (Cash/Burn/Runway/AR) + net-cash waterfall + cash-by-entity treemap + alert strip |
| **Transactions** | `transactions` | Ledger rows (matched/paired/disputed/unmatched); inline Confirm+Dispute actions for suggested matches |
| **Receivables** | `receivables` | 4 aging buckets (Current/1-30d/31-60d/60+d) + sortable invoice table |
| **Inter-Company** | `inter-company` | Royalti.io ↔ Dixtrit.media pair queue + NGN/USD personal reimbursements |
| **Reports** | `reports` | Period summary KPIs; CSV export deferred to WP-23 |

## Data

Reads from `ikenga.db` tables:
- `transaction_ledger` — ledger rows
- `receivables` — A/R invoice records
- `inter_company_entries` — cross-entity transfers
- `bank_accounts` — per-entity account registry
- `exchange_rates` — monthly FX rates
- `cfo_processing_runs` — audit log of automated bank-pull runs
- `finance_alerts` — CFO-agent alert queue (created by migration `0046_finance_domain.sql`)

## Migration

`0046_finance_domain.sql` — creates `finance_alerts` (STRICT, no FK constraints, soft TEXT links):
- `id TEXT PRIMARY KEY`
- `type TEXT NOT NULL` — `ar | interco | tax | ...`
- `severity TEXT NOT NULL DEFAULT 'warn'` — `warn | crit`
- `message TEXT NOT NULL`
- `linked_id TEXT` — soft link to receivable document_no or inter-company entry id
- `status TEXT NOT NULL DEFAULT 'active'` — `active | dismissed | resolved`
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`

**Mock contract 1:** Until `0046` lands, the alert strip is seeded from `receivables WHERE invoice_status='overdue'` + `inter_company_entries WHERE reconciliation_status!='reconciled'`. This is a documented fallback — the fallback path is exercised by try/catch in `fetchAlerts()`.

## Business rules

- **Runway warn threshold:** < 12 months → `.stat-card.is-warn`; < 6 months → `.stat-card.is-danger`
- **A/R aging colors:** Current → `bk-current` (systemic teal); 1–30d → `bk-1-30` (achievement gold); 31–60d → `bk-31-60` (primary warm brown); 60+d → `bk-60` (danger red)
- **Match confidence:** "Suggested N%" rows carry inline Confirm/Dispute buttons on hover
- **EntitySwitcher:** All/Royalti.io/Dixtrit.media/Personal filters the transaction ledger

## Workspace tint

`data-workspace="files"` (dusty warm) — placeholder until a dedicated `finance` token tint is added. Tracked as a gap in `parts/screens/finance.md §1`.

## Build

```bash
cd packages/apps/finance
pnpm install   # fetches @ikenga/tokens
node scripts/build.mjs   # vendors tokens-css.js + app-kit-css.js + finance-css.js
```

The build script copies `@ikenga/tokens/dist/tokens-css.js` and `@ikenga/tokens/dist/app-kit-css.js` into `dist/lib/` and codegens `dist/lib/finance-css.js` from `dist/finance.css`. CI guards drift with `pnpm -r build && git diff --exit-code`.
