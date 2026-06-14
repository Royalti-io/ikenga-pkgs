# research — state contract

The table-scope declaration and read/write boundary every `skill-research` action
obeys. Read this before authoring or modifying any action under `actions/`.

---

## Database

`ikenga.db` — the local SQLite database managed by the Ikenga shell.

- **Read path:** `host.dbQuery` — SELECT-only. No INSERT/UPDATE/DELETE via this path.
- **Write path:** Approved sweep proposals dispatch **through the host write path**
  (not via skill code). The skill surfaces a structured proposal list and pauses
  for operator approval; the host executes approved writes after the `approve`
  ux_mode gate.

**NOT** `pa.db`. **NOT** Supabase. **NOT** the retired `royalti-pa` lib.

---

## Table scope (declared in `manifest.json` → `permissions["sqlite.tables"]`)

The shell cross-checks this list against `tables.json` (the applied ikenga.db
STRICT schema) at install time. A table absent from `tables.json` fails install.

### Read tables (SELECT via host.dbQuery)

| Table | Used by | Purpose |
|---|---|---|
| `research_notes` | research-sweep (base cols), setup (optional infer), draft-report (reference) | Primary research knowledge base — stage, owner, entity type, status, source count |
| `research_sources` | research-sweep (freshness check, staleness evidence) | Monitored source register — name, type, cadence, status, last_checked |

### Write tables

No direct DB writes from this skill. Approved proposals are dispatched through
the host write path after the `approve` gate — the host executes the state
transition; the skill never calls `host.dbExec` directly.

**No other writes.** Research CRUD belongs to the research app pkg exclusively (R4).

**No `sales_deals` writes** — the "Hand to sales" proposal surfaces in
`research-sweep` as an `approve`-mode proposal; the host/pane commits the
`sales_deals` link on approval. This skill never touches `sales_deals`.

---

## Base columns for `research_notes`

Legal base columns (as documented in `plans/atelier-design-system/parts/screens/research.md`
§"Data shown" — real columns available in the current `ikenga.db`):

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `title` | TEXT | Report/dossier title |
| `entity_type` | TEXT | Type: `persona` / `icp` / `competitor` / `prospect` / `market` / `ddex` |
| `entity_name` | TEXT | Subject name (e.g. "DistroKid", "Mavin Records") |
| `entity_id` | TEXT | Cross-domain link key (e.g. links to `sales_deals.id` for prospect dossiers) |
| `summary` | TEXT | Short summary / sub-label |
| `body` | TEXT | Full report body |
| `source_urls` | TEXT | JSON array of source URLs; parse for count |
| `research_depth` | TEXT | Depth meta: `brief` / `standard` / `deep` |
| `tags` | TEXT | JSON array of tag strings |
| `fit_score` | REAL | Persona / prospect fit score 0–1 |
| `fit_notes` | TEXT | Fit score notes |
| `status` | TEXT | Stage: `draft` / `review` / `validated` |
| `researched_by` | TEXT | Owner: human email or agent slug (`research-agent`) |

Extended domain columns (`next_action`, `next_action_target`, `agent_cycle_id`,
`is_stale`, `word_count`, `owner`) do NOT yet exist in the current `ikenga.db`
schema. They are added by the domain WP migration (WP-22b equivalent). The
`research-sweep` action uses only the base columns above until that migration runs.

---

## Base columns for `research_sources`

`research_sources` does not yet exist in `ikenga.db`. The domain WP migration
creates it. Expected minimum schema:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key |
| `name` | TEXT | Source name (e.g. "Spotify for Artists changelog") |
| `type` | TEXT | Source type: `market` / `ddex` / `competitor` / `prospect` |
| `cadence` | TEXT | Check cadence: `daily` / `weekly` / `monthly` |
| `status` | TEXT | Freshness: `fresh` / `signal` / `stale` |
| `last_checked` | TEXT | ISO-8601 timestamp of last check |

Until the migration runs, `research-sweep` reads `research_notes` only and notes
that the sources table is not yet available.

---

## Research stage enum (Pipeline-stages convention, R-04)

The research domain's stage enum per the R-04 Pipeline-stages convention
(`06-skill-action-contract.md §Pipeline-stages`):

| Stage | Terminal? | Notes |
|---|---|---|
| `draft` | no | Report being assembled; initial default |
| `review` | no | Awaiting operator or agent review |
| `validated` | no | Reviewed and confirmed accurate |
| `archived` | **yes** | Retired / superseded — no sweep action targets this |

`archived` is a read-only terminal: no stage-advance proposal from this skill
crosses INTO `archived`. The host writes `archived` when an operator retires a note.

---

## Stale thresholds (business rules)

Stage-specific stale thresholds for `research_notes` (used by `research-sweep`):

| Stage | Stale after | Rationale |
|---|---|---|
| `draft` | 14 days | Research draft that sits idle may become stale before review |
| `review` | 7 days | Review blocking is a pipeline risk |
| `validated` | 30 days | Validated reports need a periodic freshness refresh |

Source freshness thresholds for `research_sources` (used by `research-sweep`):

| Cadence | Stale if last_checked older than | Status token |
|---|---|---|
| `daily` | 2 days | `signal` at 1d, `stale` at 2d |
| `weekly` | 7 days | `signal` at 5d, `stale` at 7d |
| `monthly` | 30 days | `signal` at 21d, `stale` at 30d |

These defaults are confirmed / overridden by the operator during `setup`
(written to `.atelier/skill-research/manifest.json`).

---

## Dispatch scope (R4 — DISPATCH-ONLY)

Per R4: skill-research is **dispatch-only**. The three verbs are:

1. **setup** — project-config only; no DB reads beyond optional infer_sources;
   writes the instance file (`.atelier/skill-research/manifest.json`) via the
   `fs` capability. Zero DB writes.
2. **research-sweep** — read-only aggregation from `research_notes` (base cols) +
   `research_sources`; produces structured stale-refresh and stage-advance proposals;
   pauses for operator approval. Approved advances are committed by the host, not the skill.
3. **draft-report** — gathers report fields in chat (D-02); confirmed creation is
   written by the pane/host path. Zero DB writes from the skill.

**Zero CRUD verbs** — creating, editing, or deleting research notes is out of
scope. Adding CRUD to any action in this skill is a scope violation (R4).

**Zero web-scraping verbs** — live source fetching and re-scraping are dispatched
through the host after operator approval. The skill surfaces the proposal; the
host triggers the agent job.

**Zero cross-domain write verbs** — the "Hand to sales" proposal surfaces as an
`approve`-mode proposal; the host commits the `sales_deals` link on approval.
This skill never writes to `sales_deals`.

**Zero query verbs** — no SELECT-shaped action surface. Interactive data
questions route through `skill-query` (R-03 Query-collapse).

---

## Pipeline-stages convention (R-04)

Stage advances declared in `research-sweep` proposals follow the ux-mode mapping
from `06-skill-action-contract.md §Pipeline-stages`:

| Proposal type | ux_mode |
|---|---|
| Intra-stage agent move (agent acts autonomously within a stage) | `silent` |
| Operator one-off advance | `confirm` |
| Outward dispatch (hand-to-sales, source re-scrape trigger) or terminal-crossing | `approve` |

Stage enum (confirmed by `setup`, written to `.atelier/skill-research/manifest.json`):
`draft → review → validated` (terminal: `archived`)

Any proposal that triggers an outward commit (hand-to-sales link, sales_deals
write, source re-scrape job) requires `ux_mode: approve` regardless of stage.

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
${CLAUDE_PROJECT_DIR}/.atelier/skill-research/manifest.json
```

### manifest.json shape

```json
{
  "skill": "skill-research",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "monitored_sources": [],
    "default_depth": "standard",
    "owner": "nedjamez",
    "research_types": ["persona", "competitor", "prospect", "market", "ddex"],
    "stale_thresholds": {
      "draft": 14,
      "review": 7,
      "validated": 30
    },
    "source_stale_thresholds": {
      "daily": 2,
      "weekly": 7,
      "monthly": 30
    },
    "sweep_cron": "0 8 * * 1-5"
  }
}
```
