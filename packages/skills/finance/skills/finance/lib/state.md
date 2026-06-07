# finance — state contract

The table-scope declaration and read/write boundary every `skill-finance` action
obeys. Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** Approved reconciliation decisions dispatch **through the host write path**
  (not via skill code). The skill surfaces structured proposal lists and pauses
  for operator approval; the host executes approved writes after the `approve`
  ux_mode gate.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `transaction_ledger` | reconcile-sweep | Ledger rows — match_state, amount, entity, description, counterparty, payment_type |
| `receivables` | ar-chase | A/R invoice records — invoice_status, due_date, balance_left, customer, currency |
| `inter_company_entries` | reconcile-sweep | Cross-entity transfers — reconciliation_status, source_entity, destination_entity, amount |
| `bank_accounts` | reconcile-sweep | Per-entity account registry — entity, currency, account_name; used to anchor entity context in reconcile decisions |
| `exchange_rates` | reconcile-sweep, ar-chase | Monthly FX rates — used to express native amounts in USD for confidence scoring |
| `contacts` | ar-chase | Contact details — resolved via customer email for AR follow-up context (name, phone, last_contact) |

### Write tables

No direct DB writes from this skill. Approved reconciliation and AR-chase
decisions are dispatched through the host write path after the `approve`
gate — the host writes the `match_state` / `reconciliation_status` transitions
and logs; the skill never calls `host.dbExec` directly.

**No other writes.** Transaction CRUD and payment release belong to the finance
app pkg exclusively (R4).

---

## Dispatch scope (R4 — DISPATCH-ONLY)

Per R4: skill-finance is **dispatch-only**. The three verbs are:

1. **setup** — project-config only; reads no DB tables (questions are posed to
   operator in chat; infers nothing from `ikenga.db`); writes the instance file
   (`.atelier/skill-finance/manifest.json`) via the `fs` capability. Zero DB writes.
2. **reconcile-sweep** — read-only aggregation from `transaction_ledger`
   (unmatched rows) + `inter_company_entries` (unreconciled) + evidence tables;
   produces structured match/pair/dispute decisions with confidence evidence;
   pauses for operator approval. Approved decisions are committed by the host,
   not the skill.
3. **ar-chase** — read-only from `receivables` (overdue rows) + `contacts`
   (enrichment); drafts follow-up communication decisions; approved draft lands
   in the mail domain's approved-drafts flow. Transport belongs to `skill-outbound`.
   Zero DB writes from the skill.

**Zero CRUD verbs** — creating, editing, or deleting transactions/invoices is
out of scope. Adding CRUD to any action in this skill is a scope violation (R4).

---

## Query-collapse (R-03 — PERMANENT RULE)

**This skill ships zero query actions.** The Finance pane computes KPI stats
(Cash / Burn / Runway / A/R totals) client-side from `host.dbQuery`. Ad-hoc
financial questions ("what is our runway this month?") route through
`com.ikenga.skill-query`. The R-03 rule is permanent and lintable: no
SELECT-shaped action surface may be added to this skill.

---

## No payment-release action

Payment authorization and disbursement belong to the approve-gate + host path.
The `reconcile-sweep` action may identify a payment obligation in its proposals,
but it never initiates or approves fund movement. Any proposed payment is tagged
`ux_mode: approve` in the sweep output and routed to the host approve-gate
surface — outside this skill's scope.

---

## Action-level capability declaration

Every action that touches the DB must declare `sqlite` in `requires_capabilities`:

```yaml
requires_capabilities:
  - sqlite    # reads ikenga.db via host.dbQuery
  - chat      # drives the dock chat engine
```

The manifest's `permissions["sqlite.tables"]` is the coarse grant; the
`requires_capabilities: [sqlite]` in the action frontmatter is the action-level
assertion. Both layers cross-validate at install time.

The `setup` action does NOT need `sqlite` (the interview asks the operator
directly; no DB read required). It carries `requires_capabilities: [fs, chat]`.

---

## Setup instance file

`setup` writes a project-local instance file per the WP-06 `.atelier/<skill>/`
convention:

```
${CLAUDE_PROJECT_DIR}/.atelier/skill-finance/manifest.json
```

### manifest.json shape

```json
{
  "skill": "skill-finance",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "entities": [
      { "name": "Royalti.io", "currencies": ["USD", "NGN"] },
      { "name": "Dixtrit.media", "currencies": ["USD"] },
      { "name": "Personal", "currencies": ["NGN"] }
    ],
    "base_currency": "USD",
    "runway_target_months": 12,
    "alert_thresholds": {
      "runway_warn_months": 12,
      "runway_danger_months": 6,
      "ar_overdue_chase_days": 30,
      "ar_critical_days": 60,
      "reconcile_sweep_cron": "0 7 * * 1-5"
    }
  }
}
```
