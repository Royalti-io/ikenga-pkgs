# @ikenga/skill-finance

**Finance skill** — dispatch-only reconciliation sweep and A/R-chase surface for the Ikenga finance domain.

## What this skill does

`skill-finance` gives the operator (and `cfo-agent`) three actions that work _against_ the live finance data in `ikenga.db`, without owning any CRUD:

| Action | Mode | Trigger | One-liner |
|---|---|---|---|
| `setup` | `streaming` | manual | Configure the finance skill for the current project: entities, currencies, runway target, and alert thresholds. Writes `.atelier/skill-finance/manifest.json`. |
| `reconcile-sweep` | `approve` | manual + weekday 07:00 | Read unmatched `transaction_ledger` rows and unreconciled `inter_company_entries`; draft match/pair/dispute decisions with confidence evidence (the "Suggested 92%" pattern); pause for operator approval before any host write. |
| `ar-chase` | `approve` | manual | Read overdue `receivables`; draft follow-up decisions; approved draft lands in the mail domain's approved-drafts flow. This skill never sends — transport belongs to `skill-outbound`. |

All three actions are **dispatch-only** per R4 — transaction CRUD and payment release belong to `com.ikenga.finance`, not here.

## State contract

- **Reads:** `host.dbQuery` (SELECT-only) — `transaction_ledger`, `receivables`, `inter_company_entries`, `bank_accounts`, `exchange_rates`, `contacts`.
- **Writes:** Approved reconciliation decisions dispatch through the host write path after the `approve` gate. The skill never calls `host.dbExec` directly.
- **Instance config:** `${CLAUDE_PROJECT_DIR}/.atelier/skill-finance/manifest.json` (written by `setup`).

## Query-collapse (R-03)

This skill ships **zero query actions**. The Finance pane computes KPI stats client-side from `host.dbQuery`; cross-domain ad-hoc questions route through `com.ikenga.skill-query`. See `06-skill-action-contract.md §Query-collapse`.

## Install

```bash
ikenga add @ikenga/skill-finance
```

Requires `com.ikenga.skill-core` (resolved via the `requires` field in `manifest.json`).

## License

Apache-2.0 — [ikenga.dev](https://ikenga.dev)
