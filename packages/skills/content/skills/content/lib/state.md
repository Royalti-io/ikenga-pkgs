# content — state contract

The table-scope declaration and read/write boundary every `skill-content` action
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

## Base-columns-only constraint (Mock contract 3 — WP-21a)

`pipeline-sweep` is bound by the **pre-0047 base-columns-only** rule:

> The skill may only query columns that exist in `ikenga.db` BEFORE the WP-21b
> migration (migration 0047) runs. App-layer columns added by that migration
> (`next_action`, `next_action_mode`, `series_name`, `series_part`, etc.) are
> **not visible to this skill**.

Legal base columns for `content_calendar`:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `type` | TEXT | Content type: `blog` / `newsletter` / `social` / `video` |
| `channel` | TEXT | Publication channel: `royalti.io` / `Listmonk` / `LinkedIn` / `X` / `YouTube` |
| `platform` | TEXT | Platform override (if different from channel) |
| `title` | TEXT | Piece title |
| `slug` | TEXT | URL slug (nullable) |
| `status` | TEXT | Editorial stage: `idea` / `outline` / `draft` / `review` / `scheduled` — maps to the stage enum |
| `assigned_to` | TEXT | Owner (human email or agent slug: `blog-writer` / `content-agent` / `cmo-agent` / `social-agent`) |
| `publish_date` | TEXT | ISO-8601 target publish date (nullable) |
| `publish_time` | TEXT | HH:MM publish time (nullable) |
| `actual_publish_date` | TEXT | Populated when published (nullable) |
| `campaign` | TEXT | Campaign grouping (nullable) |
| `created_at` | TEXT | ISO-8601 row creation timestamp |

Any SQL in `pipeline-sweep` that references a column **not in this list** is a
scope violation (Mock contract 3). The DoD grep check confirms compliance.

---

## Content stage enum (Pipeline-stages convention, R-04)

The content domain's stage enum per the R-04 Pipeline-stages convention
(`06-skill-action-contract.md §Pipeline-stages`):

| Stage | Terminal? | Notes |
|---|---|---|
| `idea` | no | Piece concept, not yet outlined |
| `outline` | no | Structure drafted, not yet written |
| `draft` | no | Active writing in progress |
| `review` | no | Awaiting operator or agent review |
| `scheduled` | no | Approved and scheduled for publish |
| `published` | **yes** | Piece is live — no sweep action targets this |

`published` is a read-only terminal: no stage-advance proposal from this skill
crosses INTO `published`. The host writes `published` when the scheduled piece
fires.

---

## Stale thresholds (business rules)

Stage-specific stale thresholds (used by `pipeline-sweep`):

| Stage | Stale after | Rationale |
|---|---|---|
| `idea` | 14 days | Slow-moving concepts are expected; 14d is a reasonable nudge |
| `outline` | 14 days | Outline phase can stall; 14d keeps momentum |
| `draft` | 7 days | Active writing should not sit idle >1 week |
| `review` | 7 days | Review blocking is a pipeline risk; escalate after 7d |
| `scheduled` | 3 days past `publish_date` | Scheduled but not yet published = overdue |

These defaults are confirmed / overridden by the operator during `setup`
(written to `.atelier/skill-content/manifest.json`).

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `content_calendar` | pipeline-sweep (base cols only), setup (optional infer) | Primary editorial pipeline — stage, owner, publish date, type |
| `social_queue` | pipeline-sweep (evidence for social pieces) | Queued social posts; `status` + `scheduled_for` as evidence |
| `calendar_events` | pipeline-sweep (optional context) | Time-anchored events that may affect publish cadence |
| `content_performance_history` | (reserved for future action) | Historical performance metrics; not read by current actions |

### Write tables

No direct DB writes from this skill. Approved stage-advance proposals are
dispatched through the host write path after the `approve` gate — the host
writes the `content_calendar.status` transition; the skill never calls
`host.dbExec` directly.

**No other writes.** Content CRUD belongs to the content app pkg exclusively (R4).

---

## Dispatch scope (R4 — DISPATCH-ONLY)

Per R4: skill-content is **dispatch-only**. The three verbs are:

1. **setup** — project-config only; no DB reads beyond optional infer_sources;
   writes the instance file (`.atelier/skill-content/manifest.json`) via the
   `fs` capability. Zero DB writes.
2. **pipeline-sweep** — read-only aggregation from `content_calendar` (base cols) +
   evidence tables; produces structured stage-advance proposals; pauses for
   operator approval. Approved advances are committed by the host, not the skill.
3. **draft-piece** — gathers piece fields in chat (D-02); confirmed creation is
   written by the pane/host path. Zero DB writes from the skill.

**Zero CRUD verbs** — creating, editing, or deleting content pieces is out of
scope. Adding CRUD to any action in this skill is a scope violation (R4).

**Zero video-production verbs** — no Remotion rendering, FFmpeg encoding, or
video scheduling. Video pieces appear as tracking entries only (G-VIDEO-STACK, R23).

**Zero publish/send verbs** — social post send, newsletter dispatch, and deploy
triggers belong to `skill-outbound` (R22). This skill proposes stage advances
and piece drafts; it does not dispatch outward.

**Zero query verbs** — no SELECT-shaped action surface. Interactive data
questions route through `skill-query` (R-03 Query-collapse).

---

## Pipeline-stages convention (R-04)

Stage advances declared in `pipeline-sweep` proposals follow the ux-mode mapping
from `06-skill-action-contract.md §Pipeline-stages`:

| Proposal type | ux_mode |
|---|---|
| Intra-stage agent move (agent acts autonomously within a stage) | `silent` |
| Operator one-off advance | `confirm` |
| Terminal-crossing advance (review → scheduled with outward commit) or any outward dispatch | `approve` |

Stage enum (confirmed by `setup`, written to `.atelier/skill-content/manifest.json`):
`idea → outline → draft → review → scheduled` (terminal: `published`)

Any advance that would trigger an outward commit (newsletter send, social post,
deploy) requires `ux_mode: approve` regardless of stage.

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
${CLAUDE_PROJECT_DIR}/.atelier/skill-content/manifest.json
```

### manifest.json shape

```json
{
  "skill": "skill-content",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "channels": ["blog", "newsletter", "social", "video"],
    "active_channels": ["blog", "newsletter", "social"],
    "video_tracking_only": true,
    "series": [],
    "cadence": {
      "blog": "weekly",
      "newsletter": "weekly",
      "social": "daily"
    },
    "stale_thresholds": {
      "idea": 14,
      "outline": 14,
      "draft": 7,
      "review": 7,
      "scheduled_overdue": 3
    },
    "sweep_cron": "0 9 * * 1-5"
  }
}
```
