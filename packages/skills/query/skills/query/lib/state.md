# query — state contract

The table-scope declaration and read/write boundary every `skill-query` action
obeys. Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** NONE. `host.dbExec` is never called from this skill.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## SELECT-only proof

The SELECT-only constraint is enforced by construction: no action file in this
package contains the strings INSERT, UPDATE, DELETE, or DROP as SQL verbs. This
is verifiable mechanically:

```bash
grep -rn -i '\b\(INSERT\|UPDATE\|DELETE\|DROP\)\b' packages/skills/query/
# expected: no matches
```

The CI DoD step for WP-24 runs this grep as part of the definition of done.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

Wide read permissions are the design, not a smell — skill-query is the
cross-domain reader; breadth is intentional. The manifest's table list IS the
complete audit surface.

### Read tables (SELECT via host.dbQuery — all domains)

| Domain | Table | Purpose |
|---|---|---|
| Tasks | `tasks` | Active/pending tasks — status, priority, assignee, due_date |
| Tasks | `delegations` | Outstanding delegations — who owns what, completion status |
| Mail | `email_messages` | Inbox state — triage_category, received_at, from_address |
| Sales | `sales_deals` | Pipeline deals — stage, value, owner, close_date |
| Sales | `sales_forecasts` | Revenue forecast rows — period, amount, confidence |
| Sales | `sales_activities` | CRM activity log — type, contact, deal_id, occurred_at |
| Finance | `receivables` | Outstanding receivables — amount, due_date, status |
| Finance | `transaction_ledger` | Double-entry ledger rows — amount, account, posted_at |
| Finance | `inter_company_entries` | Inter-company journal entries — from_entity, to_entity, amount |
| Content | `content_calendar` | Scheduled content items — publish_at, channel, status |
| Content | `social_queue` | Social posts ready or queued — platform, status, scheduled_at |
| Research | `research_notes` | Research captures — body, tags, source_url, created_at |
| Strategy | `strategic_initiatives` | Strategic initiatives — goal, owner, horizon, status |
| Agents | `agent_runs` | Recent agent execution history — status, output_summary |
| Contacts | `contacts` | People/companies — name, email, role, org_id |

### Write tables

None. This skill has no write scope.

---

## Query construction rules

When building a SELECT for the operator's question:

1. **Parameterise all user-supplied values** — never interpolate strings into SQL
   directly. Use `host.dbQuery(sql, params)` where `params` is an array of bound
   values.
2. **Scope to the declared tables** — only the 15 tables above are in scope. If
   the operator asks about a table not listed, explain the limitation.
3. **One or more SELECTs per answer** — joining across domains is allowed where
   the join is read-only and the tables are both declared. Use CTEs if needed.
4. **No subqueries that mutate** — `WITH ... AS (INSERT ...)` style is forbidden.
5. **LIMIT defensively** — default to `LIMIT 100` on open-ended queries unless
   the operator requests a count or a specific range.

---

## Format mapping

| `format` input | Rendering |
|---|---|
| `brief` (default) | Prose summary — 2–5 sentences describing the answer in plain English. |
| `table` | Markdown table — column headers from the result set; one row per result. |
| `number` | Single metric — one number with a short label. |

When `format` is omitted, infer from the question: count/total/average questions
default to `number`; "show me / list / what are" questions default to `table`;
"tell me about / summarise" questions default to `brief`.

---

## Domain hint usage

The optional `domain` input is a hint only — it narrows which tables to
prioritise when the question is ambiguous. It does not restrict the SELECT: the
agent may still JOIN across domains if the answer requires it. Examples:

- `domain: finance` + "what is our runway?" → prioritise `receivables` +
  `transaction_ledger` over `sales_deals`
- `domain: tasks` + "what is overdue?" → prioritise `tasks` + `delegations`
  over `strategic_initiatives`
