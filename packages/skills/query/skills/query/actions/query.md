---
name: query
description: Translate a natural-language question into parameterised SELECTs over ikenga.db and stream the answer. SELECT-only — zero writes, zero dispatch.
domain: skill-core
ux_mode: streaming
inputs_schema:
  type: object
  properties:
    question:
      type: string
      description: The natural-language question to answer from ikenga.db data.
    domain:
      type: string
      enum: [tasks, mail, sales, outbound, finance, content, research, strategy]
      description: Optional domain hint — narrows which tables to prioritise when the question is ambiguous.
    format:
      type: string
      enum: [brief, table, number]
      description: Output format. brief = prose summary; table = markdown grid; number = single metric. Inferred from the question when omitted.
  required:
    - question
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # skill-query — cross-domain reader

    You are answering the operator's question by querying the local ikenga.db
    SQLite database via `host.dbQuery`. You are READ-ONLY: you may ONLY issue
    SELECT statements. Never issue INSERT, UPDATE, DELETE, DROP, CREATE, ALTER,
    or any statement that modifies data or schema.

    ## Operator question
    {{question}}

    ## Domain hint (optional)
    {{domain}}

    ## Requested format
    {{format}}

    ## Available tables (declared in manifest permissions["sqlite.tables"])

    | Domain   | Table                    | Key columns                                              |
    |----------|--------------------------|----------------------------------------------------------|
    | tasks    | tasks                    | id, title, status, priority, assignee, due_date, stage   |
    | tasks    | delegations              | id, task_id, delegated_to, delegated_at, completed_at    |
    | mail     | email_messages           | id, from_address, subject, received_at, triage_category  |
    | sales    | sales_deals              | id, name, stage, value, owner, close_date                |
    | sales    | sales_forecasts          | id, period, amount, confidence, owner                    |
    | sales    | sales_activities         | id, type, contact_id, deal_id, occurred_at               |
    | finance  | receivables              | id, payer, amount, due_date, status                      |
    | finance  | transaction_ledger       | id, account, amount, direction, posted_at, memo          |
    | finance  | inter_company_entries    | id, from_entity, to_entity, amount, posted_at            |
    | content  | content_calendar         | id, title, channel, publish_at, status, author           |
    | content  | social_queue             | id, platform, body, scheduled_at, status                 |
    | research | research_notes           | id, title, body, tags, source_url, created_at            |
    | strategy | strategic_initiatives    | id, goal, owner, horizon, status, created_at             |
    | agents   | agent_runs               | id, agent_id, status, output_summary, started_at         |
    | contacts | contacts                 | id, name, email, role, org_id, created_at                |

    ## Instructions

    1. Analyse the question and the domain hint (if provided) to determine which
       table(s) to query.

    2. Build one or more parameterised SELECT statements. Use `host.dbQuery(sql, params)`
       where `params` is an array of bound values. Never interpolate user-supplied
       strings into SQL directly.

    3. Apply a default LIMIT of 100 on open-ended row queries unless the question
       asks for a count, total, average, or specifies a range.

    4. Format the answer according to the `format` input:
       - `brief` — 2–5 sentences of plain-English prose describing the result.
       - `table` — markdown table with column headers from the result set.
       - `number` — single metric (the number + a short label, e.g. "14 overdue tasks").
       - (omitted) — infer from the question: count/total/average → `number`;
         "show me / list / what are" → `table`; "tell me about / summarise" → `brief`.

    5. If a table is not in the declared list above, tell the operator the data is
       not accessible from this skill rather than querying an undeclared table.

    6. Stream your answer as you go — do not wait for all queries to complete before
       outputting anything.

    ## Hard constraints (repeat to self before every query)

    - ONLY SELECT. No INSERT, UPDATE, DELETE, DROP, CREATE, ALTER.
    - Parameterise all user-supplied values — no string interpolation in SQL.
    - Only query tables declared in the manifest permissions list above.
    - No `host.dbExec` — this skill has no write scope.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - sqlite
  - chat
---

# action: query

The single action of `skill-query`. Translates operator questions into
parameterised SELECTs over `ikenga.db` and streams the formatted answer.

## Constraints (immutable — do not relax)

- **SELECT-only.** No INSERT, UPDATE, DELETE, DROP, CREATE, or ALTER may appear
  in any query issued by this action. The `lib/state.md` SELECT-only proof and
  CI grep enforce this by construction.
- **No `host.dbExec`.** This skill has no write scope. Every DB interaction goes
  through `host.dbQuery`.
- **Declared tables only.** The 15 tables in `lib/state.md` and
  `manifest.json → permissions["sqlite.tables"]` are the complete readable set.

## Source inventory rows absorbed (R-03)

| Retired surface | Former invoker | What it did |
|---|---|---|
| `pa-query` | `agent:pa-assistant` (auto-trigger) | Supabase schema + CLI for emails, tasks, calendar, runs, delegations |
| `ceo-query` | `agent:ceo-agent` (auto-trigger) | Supabase schema + CLI for strategic initiatives, risks, task management |
| `cfo-query` | `agent:cfo-agent` (auto-trigger) | Supabase financial ledger schema + CLI for transactions, accounts, metrics |
| `cmo-query` | `agent:cmo-agent` (auto-trigger) | Supabase schema for content calendar, performance metrics, marketing snapshots |
| `sales-query` | standalone (auto-trigger) | Supabase schema + CLI for sales_deals, conversion metrics, forecasting |

All five are fully absorbed. R-03 is closed.

## Format inference rules

When `format` is omitted, apply this heuristic before building the SQL:

| Question pattern | Inferred format |
|---|---|
| "how many", "count", "total", "average", "sum" | `number` |
| "show me", "list", "what are", "which", "give me a table" | `table` |
| "tell me about", "summarise", "what is", "describe" | `brief` |

Default to `brief` when the question matches none of the above.

## Example interactions

**Count query (→ number)**
> "How many open tasks are assigned to the finance agent?"

```sql
SELECT COUNT(*) as count FROM tasks WHERE status = 'open' AND assignee = ?
-- params: ['finance-agent']
```
Output: "14 open tasks assigned to the finance agent."

**Range query (→ table)**
> "Show me deals that closed last month."

```sql
SELECT name, stage, value, close_date, owner
FROM sales_deals
WHERE stage IN ('won', 'lost')
  AND close_date >= ? AND close_date < ?
ORDER BY close_date DESC
LIMIT 100
-- params: ['2026-05-01', '2026-06-01']
```
Output: markdown table of deal name, stage, value, close date, owner.

**Prose query (→ brief)**
> "Tell me about our content pipeline this week."

```sql
SELECT title, channel, publish_at, status
FROM content_calendar
WHERE publish_at >= ? AND publish_at < ?
ORDER BY publish_at ASC
LIMIT 100
-- params: ['2026-06-02', '2026-06-09']
```
Output: prose summary of items in the pipeline, counts by status, next item up.
