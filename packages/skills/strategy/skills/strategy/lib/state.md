# strategy — state contract

The table-scope declaration and read/write boundary every `skill-strategy` action
obeys. Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** Approved countersign and next-action proposals dispatch **through
  the host write path** (not via skill code). The skill surfaces a structured
  proposal list and pauses for operator approval; the host executes approved
  writes after the `approve` ux_mode gate.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Table availability

Tables fall into two tiers:

### Existing tables (available now)

These tables exist in `ikenga.db` today and may be queried by this skill:

| Table | Role in strategy domain |
|---|---|
| `strategic_initiatives` | Primary source for open objectives/goals — one row per initiative per quarter |
| `architecture_decisions` | Product/technical decisions surfaced in strategy reviews; `area` maps to board column |
| `ideas_backlog` | Backlog items promoted into strategy work; `alignment_score` drives at-risk flags |
| `feature_score_history` | RICE scoring history; used as KR-progress proxy for product-domain objectives |
| `review_items` | Review/retrospective log — `content_type = 'strategy'` filters the strategy set |

### Schema-TBD tables (created by the domain WP on first launch)

These tables do not yet exist in `ikenga.db`. They are created by
`com.ikenga.strategy` on first mount via `host.dbExec` (WP-23 domain build):

| Table | Role |
|---|---|
| `strategy_objectives` | OKR objectives — `id`, `title`, `area`, `cycle_id`, `overall_pct`, `owner`, `ux_mode`, `next_action`, `created_at` |
| `strategy_key_results` | Per-objective KRs — `id`, `objective_id`, `label`, `pct`, `is_low`, `is_mid` |
| `strategy_cycles` | Planning cycles — `id`, `name`, `start_date`, `end_date`, `status`, `objective_count`, `kr_count`, `avg_pct` |

**While schema-TBD tables are absent**, `strategy-review` gracefully degrades:
it reads from `strategic_initiatives` (existing) for the objectives sweep, and
`review_items` (existing) for the review log. It notes in the proposal header
that the `strategy_objectives` / `strategy_key_results` / `strategy_cycles`
tables are not yet created and full OKR KR-level detail is unavailable.

---

## Legal columns for existing tables

### `strategic_initiatives`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `quarter` | TEXT | e.g. `Q2 2026` |
| `name` | TEXT | Initiative / objective name |
| `description` | TEXT | Detail |
| `status` | TEXT | e.g. `active`, `paused`, `closed` |
| `owner_agent` | TEXT | Agent slug or human email |
| `supporting_agents` | TEXT | Comma-separated agent slugs |
| `ties_to_goal` | TEXT | Area / goal grouping: `Company`, `Growth`, `Product`, `Finance` |
| `success_criteria` | TEXT | Definition of done |
| `key_deliverables` | TEXT | Comma-separated deliverable list |

### `architecture_decisions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `title` | TEXT | ADR title |
| `status` | TEXT | `proposed`, `accepted`, `superseded` |
| `decision_date` | TEXT | ISO-8601 |
| `owner` | TEXT | Human email or agent slug |
| `area` | TEXT | Domain area |
| `summary` | TEXT | One-paragraph summary |
| `tags` | TEXT | Comma-separated tags |

### `ideas_backlog`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `short_id` | TEXT | Short reference |
| `title` | TEXT | Idea title |
| `summary` | TEXT | Detail |
| `status` | TEXT | `new`, `reviewing`, `accepted`, `rejected`, `archived` |
| `priority` | TEXT | `p1`…`p4` |
| `owner_agent` | TEXT | Agent slug |
| `alignment_score` | INTEGER | 0–100; < 50 triggers at-risk flag |
| `alignment_notes` | TEXT | Rationale for score |

### `feature_score_history`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `feature_id` | TEXT | FK to backlog item (soft link) |
| `score_date` | TEXT | ISO-8601 |
| `rice_score` | REAL | Computed RICE score |
| `rice_reach` | REAL | Reach factor |
| `rice_impact` | REAL | Impact factor |
| `rice_confidence` | REAL | Confidence factor |
| `rice_effort` | REAL | Effort factor |

### `review_items`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `content_type` | TEXT | Domain filter — use `'strategy'` |
| `title` | TEXT | Review item title |
| `summary` | TEXT | Detail |
| `source_table` | TEXT | Originating table |
| `source_id` | TEXT | Originating row id (soft link) |
| `status` | TEXT | `scheduled`, `draft`, `done` |
| `reviewed_at` | TEXT | ISO-8601 (nullable) |
| `review_notes` | TEXT | Outcome notes |
| `priority` | TEXT | `p1`…`p4` |
| `created_by` | TEXT | Agent or human |

---

## Strategy ux-mode map (Business rules — strategy.md O-01..O-08)

Per the strategy screen fixture, each objective carries one of three ux-modes:

| ux_mode | When | Fixture examples |
|---|---|---|
| `silent` | Agent acts autonomously (nightly metric sync, auto-refresh forecast) | O-04 (cmo-agent forecast), O-07 (cfo-agent nightly reconcile) |
| `confirm` | Operator must confirm before agent proceeds; low external risk | O-01 (review weekly metric), O-03 (draft outreach), O-05 (lock designs), O-08 (resolve unmatched txns) |
| `approve` | Operator must countersign before external commit fires (E-11 gate) | O-02 (countersign SAFE), O-06 (approve DDEX GA checklist) |

The `approve` gate (E-11) is mandatory for any action that commits an outward
side-effect: signing legal documents, triggering GA pipelines, or dispatching
to a third-party system. The `confirm` gate applies to agent-driven actions
where the operator can veto before the agent proceeds. `silent` requires no
operator interaction — the agent's scheduled action is shown as a read-only
label in the pane.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. Tables not yet in `tables.json` (the three
schema-TBD tables) are created by the domain WP on first launch via
`host.dbExec` — the skill itself never creates tables.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `strategic_initiatives` | strategy-review, setup (optional infer) | Primary objective source — quarter, area, status, owner, deliverables |
| `architecture_decisions` | strategy-review (evidence) | Product/technical decisions as context for strategy proposals |
| `ideas_backlog` | strategy-review (at-risk evidence) | Backlog alignment scores as at-risk indicators |
| `feature_score_history` | strategy-review (KR proxy evidence) | RICE scores as KR-progress proxies for product objectives |
| `review_items` | strategy-review (review log) | Review/retrospective items; `content_type = 'strategy'` filter |
| `strategy_objectives` | strategy-review (when available) | OKR objectives with progress and next-action fields |
| `strategy_key_results` | strategy-review (when available) | Per-objective KR rows with progress bars |
| `strategy_cycles` | strategy-review (when available) | Cycle status, dates, and aggregate progress |

### Write tables

No direct DB writes from this skill. Approved countersign and next-action
proposals are dispatched through the host write path after the `approve` gate —
the host writes the state transition; the skill never calls `host.dbExec` directly.

**No other writes.** Strategy CRUD belongs to the strategy app pkg exclusively (R4).

---

## Dispatch scope (R4 — DISPATCH-ONLY)

Per R4: skill-strategy is **dispatch-only**. The three verbs are:

1. **setup** — project-config only; no DB reads beyond optional infer_sources;
   writes the instance file (`.atelier/skill-strategy/manifest.json`) via the
   `fs` capability. Zero DB writes.
2. **strategy-review** — read-only aggregation from existing tables + optional
   schema-TBD tables; produces structured countersign proposals; pauses for
   operator approval. Approved actions are committed by the host, not the skill.
3. **draft-objective** — gathers objective fields in chat (D-02); confirmed
   creation is written by the pane/host path. Zero DB writes from the skill.

**Zero CRUD verbs** — creating, editing, or deleting objectives is out of scope.
**Zero cross-domain queries** — finance/sales KR progress stays client-side.
**Zero query verbs** — interactive data questions route through `skill-query` (R-03).

---

## Instance file written by `setup`

```
${CLAUDE_PROJECT_DIR}/.atelier/skill-strategy/manifest.json
```

### manifest.json shape

```json
{
  "skill": "skill-strategy",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "active_cycle": "Q2 2026",
    "objective_areas": ["Company", "Growth", "Product", "Finance"],
    "owner_agents": ["cmo-agent", "cfo-agent", "product-agent", "strategy-agent"],
    "at_risk_threshold_pct": 50,
    "at_risk_threshold_days_elapsed": 30,
    "review_cron": "0 9 * * 1"
  }
}
```
