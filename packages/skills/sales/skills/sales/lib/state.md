# sales — state contract

The table-scope declaration and read/write boundary every `skill-sales` action
obeys. Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** Approved stage-advance proposals dispatch **through the host write path**
  (not via skill code). The skill surfaces a structured proposal list and pauses
  for operator approval; the host executes approved writes after the `approve`
  ux_mode gate.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Base-columns-only constraint (Mock contract 2 — WP-18a)

`pipeline-sweep` is bound by the **pre-0043 base-columns-only** rule:

> The skill may only query columns that exist in `ikenga.db` BEFORE the WP-18b
> migration (migration 0043) runs. App-layer columns added by that migration
> (`title`, `owner`, `next_action`, `next_action_mode`, `win_probability`,
> `age_days`) are **not visible to this skill**.

Legal base columns for `sales_deals`:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `company` | TEXT | Company name |
| `contact_name` | TEXT | Primary contact |
| `contact_email` | TEXT | Contact email; join key for `contacts` table |
| `stage` | TEXT | Current pipeline stage (stage enum defined by `setup`) |
| `value` | REAL | Deal value in `currency` units |
| `currency` | TEXT | ISO 4217 |
| `score` | REAL | Lead score (from `sales_lead_scores`) |
| `last_contact` | TEXT | ISO-8601 date of last touch — staleness signal |
| `assigned_to` | TEXT | Owner name string (human or `sales-agent`) |
| `notes` | TEXT | Free-form notes |
| `source` | TEXT | Acquisition source |
| `loss_reason` | TEXT | Populated on lost deals |
| `description` | TEXT | Extended description |

Any SQL in `pipeline-sweep` that references a column **not in this list** is a
scope violation (Mock contract 2). The DoD grep check confirms compliance.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `sales_deals` | pipeline-sweep (base cols only), setup (optional infer) | Core deal state — stage, value, score, last_contact, assigned_to |
| `sales_activities` | pipeline-sweep (evidence) | Activity timeline — last touch events as staleness evidence |
| `sales_lead_scores` | pipeline-sweep (evidence) | Lead score history — score trend as qualification signal |
| `sales_stage_transitions` | pipeline-sweep (evidence) | Transition history — `transitioned_at` for days-in-stage calculation |
| `contacts` | pipeline-sweep (optional enrichment) | Contact details resolved via `contact_email` join |
| `sales_forecasts` | (reserved for future action — not read by current actions) | Forecast KPIs |

### Write tables

No direct DB writes from this skill. Approved stage-advance proposals are
dispatched through the host write path after the `approve` gate — the host
writes the `sales_deals.stage` transition and logs to `sales_stage_transitions`;
the skill never calls `host.dbExec` directly.

**No other writes.** Deal CRUD belongs to the sales app pkg exclusively (R4).

---

## Dispatch scope (R4 — DISPATCH-ONLY)

Per R4: skill-sales is **dispatch-only**. The three verbs are:

1. **setup** — project-config only; no DB reads beyond optional infer_sources;
   writes the instance file (`.atelier/skill-sales/manifest.json`) via the
   `fs` capability. Zero DB writes.
2. **pipeline-sweep** — read-only aggregation from `sales_deals` (base cols) +
   evidence tables; produces structured stage-advance proposals; pauses for
   operator approval. Approved advances are committed by the host, not the skill.
3. **draft-deal** — gathers deal fields in chat (D-02); confirmed creation is
   written by the pane/host path. Zero DB writes from the skill.

**Zero CRUD verbs** — creating, editing, or deleting deals is out of scope.
Adding CRUD to any action in this skill is a scope violation (R4).

---

## Pipeline-stages convention (R-04)

Stage advances declared in `pipeline-sweep` proposals follow the ux-mode mapping
from `06-skill-action-contract.md §Pipeline-stages`:

| Proposal type | ux_mode |
|---|---|
| Intra-stage agent move (agent acts autonomously within a stage) | `silent` |
| Operator one-off advance | `confirm` |
| Terminal-crossing advance (closing → won / lost) or outward dispatch | `approve` |

Stage enum (confirmed by `setup`, written to `.atelier/skill-sales/manifest.json`):
`lead → qualified → proposal → negotiation → closing → won | lost`

`won` and `lost` are terminal stages. Any advance TO a terminal requires
`ux_mode: approve`.

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

The `setup` action does NOT need `sqlite` (infer from repo context; no DB read
required for basic setup). It carries `requires_capabilities: [fs, chat]`.

---

## Instance file written by `setup`

```
${CLAUDE_PROJECT_DIR}/.atelier/skill-sales/manifest.json
```

### manifest.json shape

```json
{
  "skill": "skill-sales",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "stage_enum": ["lead", "qualified", "proposal", "negotiation", "closing", "won", "lost"],
    "win_probability": {
      "lead": 0.10,
      "qualified": 0.25,
      "proposal": 0.40,
      "negotiation": 0.65,
      "closing": 0.85,
      "won": 1.00,
      "lost": 0.00
    },
    "quarter_target": 300000,
    "stale_threshold_days": 30,
    "sweep_cron": "0 8 * * 1-5"
  }
}
```
