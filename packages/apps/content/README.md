# com.ikenga.content

Content domain surface for the Ikenga desktop. Pipeline (kanban + list) · Calendar · Published.

## Stage enum

Per the R-04 Pipeline-stages convention (`plans/atelier/06-skill-action-contract.md §Pipeline-stages`), the content domain owns the `content_pieces.stage` TEXT column. Values are lowercase:

| Stage | Description | Kanban dot colour |
|---|---|---|
| `idea` | Concept stage — not yet outlined | `--fg-faint` |
| `outline` | Structure defined | `--systemic` |
| `draft` | Writing in progress | `--primary` |
| `review` | Agent or operator review | `--achievement` |
| `scheduled` | Approved and scheduled for publish | `--live` |

Terminal stage: `published` — pieces that have been published are tracked in `content_published`.

## Migration

`0047_content_domain.sql` — creates the three content-domain tables (STRICT, no FK, soft TEXT links):

- `content_pieces` — full editorial pipeline record (id, title, content_type, channel, stage, owner, next_action, next_action_mode, format, due_at, created_at, calendar_id soft link)
- `content_published` — published-performance record (id, piece_id soft link, title, content_type, channel, published_at, views, engagement_pct)
- `content_stage_transitions` — per-piece stage history (id, piece_id soft link, from_stage, to_stage, transitioned_at, transitioned_by)

## Views

| View | URL param | Description |
|---|---|---|
| Pipeline — kanban | `?view=0` (default, `pipeMode=kanban`) | `.kb-col` columns per stage; drag to advance; seg toggle for list |
| Pipeline — list | `?view=0` + seg toggle | Piece rows grouped by stage; `.ip-split` list + detail |
| Calendar | `?view=1` | Two-week `.cal-grid` Mon–Sun; `.ct-cal-pill` colour-coded by channel |
| Published | `?view=2` | KPI cells + table of published pieces with views/engagement |

## CSS naming

- Kit classes: `.frame*` · `.dense-row--pipeline` · `.ip-split*` · `.split-row*` · `.kb-*` · `.nav-group[data-kind]` · `.atelier-state.is-*` · `.tag` · `.chip` · `.btn*` · `.seg*`
- Domain residue (`.ct-*`): `.ct-cal-grid` · `.ct-cal-pill` · `.ct-cal-legend` · `.ct-pub-kpis` · `.ct-pub-kpi` · `.ct-pub-table` · `.ct-mv-badge`

## Workspace tint

`data-workspace="studio"` — warm terracotta-red active nav indicator; differentiates from `sales` (amber-ochre) and `outbound` (red-orange).

## Data sources

Tables declared in `manifest.json` `sqlite.tables`:
- `content_pieces` — primary pipeline; created by `0047_content_domain.sql`
- `content_published` — published performance; created by `0047_content_domain.sql`
- `content_stage_transitions` — stage history; created by `0047_content_domain.sql`
- `content_calendar` — editorial scheduling (pre-existing)
- `social_queue` — social post queue (pre-existing)
- `calendar_events` — calendar-view overlays (pre-existing)

## Mock contract 2 (calendar-derivation fallback)

When `content_pieces` is empty (first launch before any pieces are added), the pipeline falls back to deriving piece rows from `content_calendar` (mapping `status` → `stage`, `type` → `content_type`). This derivation is a documented fallback; real piece creation flows through the piece-creation dock-chat action and writes to `content_pieces` directly. The fallback is demoted to a console warning once `content_pieces` has at least one real row.
