# @ikenga/skill-query

Cross-domain natural-language query skill for the Ikenga shell.

**One action: `query`** — translate a plain-English question into parameterised
`SELECT` statements over `ikenga.db`, stream the answer in the requested format.

**SELECT-only by contract.** This skill never writes to the database. No
INSERT, no UPDATE, no DELETE, no DROP anywhere in this package. The manifest's
`permissions["sqlite.tables"]` list is the complete audit surface for what this
skill may read.

---

## What it does

Ask anything about data across all Ikenga domains and get a streaming answer:

- _"How many open tasks are assigned to the finance agent?"_
- _"What deals closed last month and what was the total value?"_
- _"Show me the content calendar for this week."_
- _"What research notes mention 'streaming licensing'?"_
- _"Give me a table of receivables overdue by more than 30 days."_

The agent translates the question into one or more parameterised SELECTs via
`host.dbQuery`, then formats the answer as `brief` (prose), `table` (markdown
grid), or `number` (single metric).

---

## Domains covered

| Domain | Tables readable |
|---|---|
| Tasks | `tasks`, `delegations` |
| Mail | `email_messages` |
| Sales | `sales_deals`, `sales_forecasts`, `sales_activities` |
| Finance | `receivables`, `transaction_ledger`, `inter_company_entries` |
| Content | `content_calendar`, `social_queue` |
| Research | `research_notes` |
| Strategy | `strategic_initiatives` |
| Agents | `agent_runs` |
| Contacts | `contacts` |

---

## Absorption table (R-03 — closed)

The following retired query surfaces from the C-level skill inventory are
**absorbed by skill-query**. They are deprecated and should not be installed
alongside this package.

| Retired surface | Former home / invoker | Absorbed action |
|---|---|---|
| `pa-query` | `agent:pa-assistant` (auto-trigger) | `query` |
| `ceo-query` | `agent:ceo-agent` (auto-trigger) | `query` |
| `cfo-query` | `agent:cfo-agent` (auto-trigger) | `query` |
| `cmo-query` | `agent:cmo-agent` (auto-trigger) | `query` |
| `sales-query` | standalone (auto-trigger) | `query` |

**Why one skill instead of five?** The five former skills shared the same
foundation (`pa-query`) and differed only in which tables they documented. A
single `skill-query` with cross-domain read permissions is simpler, easier to
audit, and enforces the R-03 rule that domain skills are dispatch-only — any
"ask the DB" surface routes through this single reader. R-03 is permanently
closed on ship.

---

## What skill-query does NOT do

- **No writes** — task/email/deal CRUD belongs to the respective domain pkgs.
- **No dispatch** — scheduling sends, assigning tasks, posting content: not here.
- **No digest** — recurring briefings/reports stay with `skill-pa briefing`
  (P5 dedup decides the final owner). skill-query is interactive-only.
- **No cross-domain aggregation on behalf of other skills** — panes compute
  their own KPIs client-side from `host.dbQuery`; this skill is for operator
  questions in the dock chat, not a shared lib.

---

## Installation

```bash
ikenga add com.ikenga.skill-query
```

Requires `skill-core` (resolved automatically by Ọba).

---

## Files

```
query/
├── manifest.json                  ← pkg manifest (Zod-valid; wide read perms)
├── package.json                   ← npm metadata
├── README.md                      ← this file (absorption table + contract)
├── held-changesets/
│   ├── README.md                  ← why held; how to resume publish
│   └── skill-query-initial.md    ← held changeset entry
└── skills/
    └── query/
        ├── SKILL.md               ← router + ActionFrontmatter frontmatter
        ├── lib/
        │   └── state.md           ← table-scope contract + SELECT-only proof
        └── actions/
            └── query.md           ← the single action (full frontmatter + body)
```
