---
name: finance
description: |
  Finance dispatch — reconciliation sweep with match/pair/dispute decisions,
  A/R aging chase, and project setup for the finance domain. Reads `ikenga.db`
  via `host.dbQuery` (SELECT-only); approved decisions dispatch through the host
  write path. DISPATCH-ONLY: transaction CRUD and payment release belong to the
  finance app pkg (`com.ikenga.finance`), not here.

  TRIGGER when the user asks to reconcile transactions, review unmatched ledger
  rows, chase overdue invoices, or configure the finance skill for this project.

  DO NOT TRIGGER for transaction CRUD (create/edit/delete), payment release
  (approve-gate + host own it), or bank pull (external cron). DO NOT run KPI
  math — cash/burn/runway stays client-side in the pane (R-03 query-collapse).
  DO NOT send AR follow-ups directly — transport belongs to skill-outbound (R22).
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# finance — dispatch-only finance surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope) is in `lib/state.md` — read it
before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` ships as `com.ikenga.skill-core` on `ikenga-pkgs` main.
> Per the G-04 contract and the lint spec in `06-skill-action-contract.md` §5,
> no other target is legal.

> **Query-collapse (R-03):** This skill ships ZERO query actions. The Finance
> pane computes KPI stats (cash/burn/runway/A/R) client-side from `host.dbQuery`;
> cross-domain ad-hoc questions route through `com.ikenga.skill-query`. The
> R-03 deferral is now a permanent, lintable rule: domain skills are
> dispatch-only by construction, and a no-query-action constraint is enforced
> by inspection during DoD review.

> **No payment release:** The approve-gate and the host own payment release.
> This skill drafts reconciliation decisions for review but never executes
> bank transfers or payment authorizations.

---

## Purpose (one line)

Surface reconciliation decisions for unmatched transactions and overdue A/R —
reading `ikenga.db` state, never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure the finance skill: entities, currencies, runway target, alert thresholds. Writes `.atelier/skill-finance/manifest.json`. |
| `reconcile-sweep` | [`actions/reconcile-sweep.md`](actions/reconcile-sweep.md) | `approve` | Read unmatched ledger rows + unreconciled inter-company entries; draft match/pair/dispute decisions with confidence evidence; pause for operator approval. |
| `ar-chase` | [`actions/ar-chase.md`](actions/ar-chase.md) | `approve` | Read overdue receivables; draft follow-up decisions; approved draft lands in mail approved-drafts flow (transport = skill-outbound, R22). |

All three actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "reconcile transactions", "sweep unmatched rows", "match ledger entries", "pair inter-company" | [`actions/reconcile-sweep.md`](actions/reconcile-sweep.md) | Read `transaction_ledger` (unmatched) + `inter_company_entries` (unreconciled); draft decisions; pause for approval |
| "chase AR", "follow up overdue invoices", "Valentim invoice", "A/R aging" | [`actions/ar-chase.md`](actions/ar-chase.md) | Read `receivables` (overdue); draft follow-up decisions; pause for approval |
| "setup finance", "configure skill-finance", "finance entities", "runway target" | [`actions/setup.md`](actions/setup.md) | `interview` mode; confirm entities + currencies + runway target + thresholds in chat; write `.atelier/skill-finance/manifest.json` |

---

## What skill-finance does NOT do

- **No transaction CRUD** — create/edit/delete/classify transactions belongs to the finance app pkg (`com.ikenga.finance`).
- **No payment release** — payment authorization belongs to the approve-gate + host path; this skill never executes disbursements.
- **No bank pull** — nightly bank ingestion (Stripe/Kuda/GTB/Verto) is an external cron (`cfo_processing_runs`); this skill does not trigger it.
- **No query actions** — KPI math (cash/burn/runway/A/R totals) stays client-side in the pane (R-03). Ad-hoc ledger questions route through `skill-query`.
- **No send** — AR follow-up transport belongs to `skill-outbound`; this skill drafts the decision and hands off the draft to the mail domain's approved-drafts flow.
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.
- **No direct DB writes** — approved reconciliation decisions dispatch through the host write path; the skill never calls `host.dbExec` directly.

---

## Critical files

```
finance/
├── SKILL.md                      ← you are here (router only)
├── lib/state.md                  ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md                  ← WP-20a body
    ├── reconcile-sweep.md        ← WP-20a body
    └── ar-chase.md               ← WP-20a body
```
