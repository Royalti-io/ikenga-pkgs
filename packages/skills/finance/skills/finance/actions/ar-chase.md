---
name: ar-chase
description: Read overdue receivables via host.dbQuery; draft follow-up decisions; approved draft lands in the mail domain's approved-drafts flow. This skill never sends — transport belongs to skill-outbound (R22).
domain: finance
ux_mode: approve
inputs_schema:
  type: object
  properties:
    min_days_overdue:
      type: integer
      minimum: 1
      default: 30
      description: Minimum days overdue before an invoice enters the chase queue. Overrides .atelier/skill-finance/manifest.json if provided.
    max_invoices:
      type: integer
      minimum: 1
      default: 20
      description: Maximum number of overdue invoices to evaluate in one pass.
    entity:
      type: string
      description: Restrict chase to invoices belonging to a specific entity (e.g. "Royalti.io"). Omit to chase across all entities.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Finance A/R Chase

    Read overdue receivables from `ikenga.db` via host.dbQuery. Draft follow-up
    decisions for operator approval. This skill never sends — transport belongs
    to skill-outbound (R22).

    ## Step 1 — fetch overdue receivables

    ```sql
    SELECT id, document_no, invoice_date, due_date, customer, customer_email,
           description, total_amount, amount_paid, balance_left, currency,
           invoice_status
    FROM receivables
    WHERE invoice_status IN ('overdue', 'partial')
      AND julianday('now') - julianday(due_date) >= {{min_days_overdue}}
    {{#entity}}AND id IN (
      SELECT id FROM transaction_ledger WHERE entity = :entity LIMIT 1
    ){{/entity}}
    ORDER BY julianday('now') - julianday(due_date) DESC
    LIMIT {{max_invoices}}
    ```

    ## Step 2 — enrich with contact details

    For each overdue invoice, look up the contact:

    ```sql
    SELECT name, email, company, phone
    FROM contacts
    WHERE email = :customer_email
       OR name LIKE :customer_name
    LIMIT 1
    ```

    ## Step 3 — compute aging bucket and urgency

    For each invoice, compute:
    - `days_overdue` = `julianday('now') - julianday(due_date)`
    - Aging bucket:
      - **Current** (< 0 days) — not overdue
      - **1–30 days** — gentle first chase
      - **31–60 days** — firm second chase (primary bucket for this action)
      - **60+ days** — critical, escalation required

    Apply the thresholds from `.atelier/skill-finance/manifest.json` if present;
    fall back to `min_days_overdue` (default 30) and `ar_critical_days` (default 60).

    **Hero invoice (fixture context):**
    INV-2026-038 · Valentim de Carvalho · €2,182 · $2,400 · 31 days · contract
    signed. This is the primary critical item; lead with it in the decision list.

    ## Step 4 — draft follow-up decisions

    For each overdue invoice, draft a follow-up decision:

    ```
    INVOICE:      <document_no> — <customer>
    BALANCE:      <balance_left> <currency> (= <USD equiv> USD)
    DAYS OVERDUE: <days_overdue>d — <aging bucket>
    CONTACT:      <name> · <email>
    URGENCY:      low (1–30d) | medium (31–60d) | high (60+d)
    ACTION:       draft follow-up email | escalate to founder | flag for legal
    DRAFT COPY:   <short draft subject + first paragraph — {{ tone }}>
    REASON:       <one-line rationale>
    ```

    **Tone guidelines by bucket:**
    - **1–30d:** Friendly reminder — "Just checking in on invoice {{document_no}}.
      Per our records, this was due on {{due_date}}. Please let me know if you
      have any questions."
    - **31–60d:** Firm — "This is a follow-up regarding invoice {{document_no}}
      ({{balance_left}} {{currency}}), now {{days_overdue}} days past due.
      Please arrange payment at your earliest convenience."
    - **60+d:** Urgent — "Invoice {{document_no}} is now {{days_overdue}} days
      overdue (${{balance_left_usd}} outstanding). Without payment or a confirmed
      payment schedule within 5 business days, we will be required to escalate
      this matter."

    ## Step 5 — pause for approval (ux_mode: approve)

    Present the full decision list and STOP. Do not write anything to the DB.
    Do not send any email. Approved drafts will be routed to the mail domain's
    approved-drafts flow; transport is owned by skill-outbound (R22).

    **IMPORTANT:** This skill never sends. On approval, the decision is handed
    to the mail domain's approved-drafts queue. The host routes it from there.
    Do not call host.dbExec. Do not invoke skill-outbound directly.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: ar-chase

> **WP-20a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Reads `ikenga.db` via `host.dbQuery` to identify overdue A/R invoices that need
follow-up. Produces a structured decision list with per-invoice follow-up drafts
(subject + opening paragraph), then pauses for operator approval (`ux_mode: approve`
— E-11 gate). Approved drafts land in the mail domain's approved-drafts flow;
transport is owned by `skill-outbound` (R22 decision). This skill never sends.

## The R22 transport handoff

**R22 decision (wave-3):** `ar-chase` is the finance domain's write surface for
AR follow-up. It drafts the communication decision; it never sends. On approval:

1. The approved draft (subject + body) is handed to the mail domain's
   `approved-drafts` queue via the host route.
2. `skill-outbound send` owns the actual email transport — outside this skill.

This is the same separation of concerns as `skill-pa`'s `send` action: skill
produces the draft; transport is downstream. The finance skill never touches
`email_drafts` or any mail table directly.

## Hero invoice (from Finance screen design)

INV-2026-038 · Valentim de Carvalho · €2,182 · $2,400 · 31 days overdue ·
contract signed. This is the primary critical item surfaced in the Finance
screen's alert strip and the receivables table (31d bucket — `.bk-31-60`,
`--primary` warm-brown tint). The action should lead the decision list with
this invoice when present.

## Aging buckets and tone

| Days overdue | Bucket | Tone | CSS class |
|---|---|---|---|
| 0 (not yet due) | Current | — (not in queue) | `.bk-current` |
| 1–30 | 1–30d | Friendly reminder | `.bk-1-30` |
| 31–60 | 31–60d | Firm follow-up | `.bk-31-60` |
| 60+ | 60+d | Urgent escalation | `.bk-60` |

These bucket classes are domain-local to the Finance pane CSS (see `finance.md`
§4 Kit vs. domain-local boundary). The action uses the bucket labels in its
decision output for clarity; the CSS classes are for the pane renderer.

## Business rules (from Finance screen doc §1)

- **Chase threshold:** Only surface invoices where `days_overdue >= min_days_overdue`
  (default 30 from `.atelier/skill-finance/manifest.json`, or the action input).
- **Critical threshold:** Invoices in the 60+ bucket are flagged HIGH urgency;
  the draft copy escalates accordingly.
- **No send from skill:** This action is constrained by R22 — transport belongs
  to `skill-outbound`. The skill's output is a communication decision, not a sent
  message.

## Tables read

| Table | Columns | Purpose |
|---|---|---|
| `receivables` | id, document_no, invoice_date, due_date, customer, customer_email, description, total_amount, amount_paid, balance_left, currency, invoice_status | A/R invoice records — filter on `invoice_status IN ('overdue', 'partial')` + days overdue |
| `contacts` | name, email, company, phone | Contact details enrichment for follow-up addressing |

All reads are SELECT-only via `host.dbQuery`. **No writes.**

## Operator approval gate (E-11)

`ux_mode: approve` — the action executes through step 4 (producing the draft
decision list with follow-up copy), then PAUSES. The operator reviews, edits,
or rejects each draft. Only after explicit approval do the drafts route to the
mail domain's approved-drafts queue — dispatched by the host, not this skill.

## No-query conformance (R-03)

This action drafts actionable follow-up decisions; it does not answer ad-hoc
A/R questions. "What is our total A/R outstanding?" routes through `skill-query`.

## SQL table coverage — declared tables only

Grep evidence (DoD check): all SQL in `run.prompt` above references only tables in
`permissions["sqlite.tables"]`:
- `receivables` ✓
- `contacts` ✓
No other tables are queried.
