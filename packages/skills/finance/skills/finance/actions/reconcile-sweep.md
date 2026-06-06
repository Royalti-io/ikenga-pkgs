---
name: reconcile-sweep
description: Read unmatched transaction_ledger rows and unreconciled inter_company_entries via host.dbQuery; draft match/pair/dispute decisions with confidence evidence; pause for operator approval before any host write.
domain: finance
ux_mode: approve
inputs_schema:
  type: object
  properties:
    max_rows:
      type: integer
      minimum: 1
      default: 100
      description: Maximum number of unmatched ledger rows to evaluate in one sweep.
    min_confidence:
      type: number
      minimum: 0
      maximum: 1
      default: 0.5
      description: Minimum confidence score (0–1) to surface a suggested match. Rows below this threshold are listed as Unmatched with no suggestion.
    entity:
      type: string
      description: Restrict sweep to a specific entity (e.g. "Royalti.io"). Omit to sweep all entities.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Finance Reconcile Sweep

    Read unmatched transaction_ledger rows and unreconciled inter_company_entries
    from `ikenga.db` via host.dbQuery. Draft match/pair/dispute decisions with
    confidence evidence for operator approval.

    ## Step 1 — fetch unmatched ledger rows

    ```sql
    SELECT id, txn_date, entity, description, counterparty, amount, currency,
           amount_usd, payment_type, account_id
    FROM transaction_ledger
    WHERE match_state IN ('unmatched', 'suggested')
    {{#entity}}AND entity = :entity{{/entity}}
    ORDER BY txn_date DESC
    LIMIT {{max_rows}}
    ```

    ## Step 2 — fetch unreconciled inter-company entries

    ```sql
    SELECT id, source_entity, destination_entity, amount, currency, amount_usd,
           transfer_type, loan_status, reconciliation_status,
           source_txn_id, destination_txn_id
    FROM inter_company_entries
    WHERE reconciliation_status != 'reconciled'
    {{#entity}}AND (source_entity = :entity OR destination_entity = :entity){{/entity}}
    ORDER BY id DESC
    ```

    ## Step 3 — fetch context for evidence scoring

    For each unmatched ledger row, gather corroborating evidence:

    **Counterparty account lookup** (for entity context):
    ```sql
    SELECT account_name, entity, currency, bank
    FROM bank_accounts
    WHERE account_id = :account_id
    ```

    **Exchange rate** (for USD amount verification on non-USD transactions):
    ```sql
    SELECT ngn_usd, eur_usd, gbp_usd
    FROM exchange_rates
    WHERE rate_month = :rate_month
    ORDER BY rate_month DESC
    LIMIT 1
    ```

    **Contact enrichment** (for vendor/customer counterparty rows where a match
    candidate is found):
    ```sql
    SELECT id, name, email, company
    FROM contacts
    WHERE email LIKE :counterparty_email
       OR name LIKE :counterparty_name
    LIMIT 1
    ```

    ## Step 4 — score match candidates and draft decisions

    For each unmatched row, identify candidates and score confidence:

    **Match scoring logic:**
    - **Exact amount + same day + known counterparty** → confidence ≥ 0.95 → "Paired"
    - **Same amount ± 1% + same week + known counterparty** → confidence 0.85–0.94 → "Suggested high"
    - **Same amount ± 5% + same month + recognisable counterparty** → confidence 0.70–0.84 → "Suggested"
    - **Amount match only or ambiguous counterparty** → confidence 0.50–0.69 → "Suggested low"
    - **No credible match found** → confidence < 0.50 → "Unmatched — manual review"

    **Inter-company pairing:**
    - An inter_company_entries row with `reconciliation_status = 'pending'` can
      be paired to a `transaction_ledger` row where the description contains the
      transfer reference, source/destination entities match, and amount_usd is
      within 1%. Confidence is computed as above.
    - A row with `source_txn_id` and `destination_txn_id` both present but
      `reconciliation_status = 'unreconciled'` is a "pair confirmed — log needed"
      case; draft a "Pair" decision.

    **Decision types:**
    - `match` — link the ledger row to a known transaction/invoice in another table
    - `pair` — link two inter-company legs into a reconciled transfer
    - `dispute` — flag the row for manual review (e.g. unexpected amount, unknown counterparty)

    Format each decision as:

    ```
    ROW:          <txn_date> · <entity> · <description>
    AMOUNT:       <amount> <currency> (= <amount_usd> USD)
    COUNTERPARTY: <counterparty>
    MATCH TYPE:   match | pair | dispute
    CONFIDENCE:   <percentage>% — <evidence summary>
    PROPOSED:     <action description>
    REASON:       <one-line rationale>
    ```

    Group output:
    1. High-confidence suggestions (≥ 85%) — "Ready to approve"
    2. Medium-confidence suggestions (50–84%) — "Review before approving"
    3. Unmatched rows — "Manual review required"
    4. Inter-company pair queue

    Respect `{{min_confidence}}`: omit any suggestion below that threshold from
    groups 1–2; move to group 3 instead.

    ## Step 5 — pause for approval (ux_mode: approve)

    Present the full proposal list and STOP. Do not write anything to the DB.
    Approved decisions will be dispatched through the host write path.

    **IMPORTANT:** This skill never writes to `ikenga.db`. The decision list is
    the deliverable; the host executes approved writes. Do not call host.dbExec.
triggers:
  - kind: manual
  - kind: schedule
    cron: "0 7 * * 1-5"
    label: Weekday morning reconcile sweep
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: reconcile-sweep

> **WP-20a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to identify unmatched transaction ledger
rows and unreconciled inter-company entries that need operator attention. Produces
a structured decision list — match / pair / dispute — with confidence evidence
(the "Suggested 92%" pattern from the Finance screen design), then pauses for
operator approval (`ux_mode: approve` — E-11 gate). Approved decisions dispatch
through the host write path; the skill never writes to the DB.

## The "Suggested 92%" confidence pattern

The Finance screen design (from `plans/atelier-design-system/parts/screens/finance.md`
§3 Interaction) surfaces match confidence as a percentage suffix: "Suggested 92%".
This action produces the evidence that powers that display. Each proposal carries:
- A confidence score (0–1, expressed as a percentage label)
- An evidence summary (basis for the score: amount match, date proximity,
  counterparty identity, entity consistency)
- A decision type (match / pair / dispute)

The operator sees "Suggested 92%" next to a row because `reconcile-sweep`
evaluated the evidence and scored it at 0.92. The host pane renders this score
as the `match_state` column badge in the Transactions tab.

## Business rules (from Finance screen doc §1)

- **Match confidence thresholds:** Exact amount + same day + known counterparty
  → ≥ 95% (auto-suggest "Paired"). Any row below `min_confidence` (default 0.50)
  is listed as "Unmatched — manual review" with no match suggestion.
- **Inter-company pair rule:** A transfer is fully reconciled when both legs are
  present in `transaction_ledger` with matching `amount_usd` (± 1%), source and
  destination entities match the `inter_company_entries` row, and the transfer
  reference appears in the descriptions.
- **Dispute rule:** A row is drafted as "dispute" when the counterparty is
  unrecognised, the amount deviates > 10% from any candidate, or the entity/
  account context is inconsistent. The operator reviews disputes manually.

## Tables read

| Table | Columns | Purpose |
|---|---|---|
| `transaction_ledger` | id, txn_date, entity, description, counterparty, amount, currency, amount_usd, payment_type, account_id, match_state | Core ledger rows — filter on `match_state IN ('unmatched', 'suggested')` |
| `inter_company_entries` | id, source_entity, destination_entity, amount, currency, amount_usd, transfer_type, loan_status, reconciliation_status, source_txn_id, destination_txn_id | Cross-entity transfers awaiting reconciliation |
| `bank_accounts` | account_name, entity, currency, bank | Entity/account context for confidence evidence |
| `exchange_rates` | rate_month, ngn_usd, eur_usd, gbp_usd | FX rate lookup for non-USD amount verification |
| `contacts` | id, name, email, company | Counterparty enrichment for match evidence |

All reads are SELECT-only via `host.dbQuery`. **No writes.**

## Operator approval gate (E-11)

`ux_mode: approve` — the action executes through step 4 (producing the draft
decision list), then PAUSES. The operator reviews, edits, or rejects decisions.
Only after explicit approval do the reconciliation writes fire — and those are
dispatched by the host, not emitted by this skill.

## Schedule trigger

Absorbed as a `0 7 * * 1-5` schedule trigger (weekday morning at 07:00), replacing
the legacy `cfo:reconcile-sweep` concept. Also available as a manual trigger for
on-demand reviews.

## No-query conformance (R-03)

This action is a reconciliation sweep, not a query action. It surfaces actionable
decisions with evidence; it does not answer ad-hoc questions or compute KPI
aggregates. Cash/burn/runway math stays client-side in the Finance pane.

## SQL table coverage — declared tables only

Grep evidence (DoD check): all SQL in `run.prompt` above references only tables in
`permissions["sqlite.tables"]`:
- `transaction_ledger` ✓
- `inter_company_entries` ✓
- `bank_accounts` ✓
- `exchange_rates` ✓
- `contacts` ✓
No other tables are queried.
