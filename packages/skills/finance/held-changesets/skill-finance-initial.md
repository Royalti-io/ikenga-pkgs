---
"@ikenga/skill-finance": minor
---

Initial release of `@ikenga/skill-finance` (WP-20a — scaffold + dispatch actions).

Introduces the Finance dispatch skill: reconciliation sweep, A/R-chase, and
project setup for the finance domain. **Dispatch-only per R4** — transaction
CRUD and payment release belong to `com.ikenga.finance`, not here.

Three actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `interview` lifecycle
  action (D-02 setup-in-chat pattern); asks the operator to confirm entities
  (Royalti.io USD+NGN, Dixtrit.media USD, Personal NGN), runway target (12 mo
  default), and alert thresholds; writes
  `${CLAUDE_PROJECT_DIR}/.atelier/skill-finance/manifest.json`.
- `reconcile-sweep` (`ux_mode: approve`) — reads unmatched `transaction_ledger`
  rows and unreconciled `inter_company_entries` via `host.dbQuery`; drafts
  match/pair/dispute decisions with confidence evidence (the "Suggested 92%"
  pattern); pauses for operator approval (E-11 gate); approved decisions
  dispatch through the host write path; runs weekday 07:00 + manual.
- `ar-chase` (`ux_mode: approve`) — reads overdue `receivables` via
  `host.dbQuery`; drafts follow-up communication decisions; approved draft
  lands in the mail domain's approved-drafts flow; this skill never sends —
  transport belongs to `skill-outbound` (R22).

All actions declare `depends_on: ["skill-core"]`, carry zero CRUD verbs, zero
query actions (R-03 Query-collapse), and no payment-release action (approve-gate
+ host own it). State lives on the local `ikenga.db` via `host.dbQuery`
(SELECT-only) — no Supabase, no `supabase_tables`. Each validates against the
locked `ActionFrontmatter` Zod (WP-06). SQL touches only the six declared tables:
`transaction_ledger`, `receivables`, `inter_company_entries`, `bank_accounts`,
`exchange_rates`, `contacts`.
