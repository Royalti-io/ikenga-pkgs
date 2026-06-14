---
"@ikenga/skill-research": minor
---

Initial release of `@ikenga/skill-research` (WP-22a — scaffold + dispatch actions).

Introduces the research domain skill: source-sweep with stale-refresh and
dossier-commission proposals, and report-draft for the research domain.
**Dispatch-only per R4** — research CRUD belongs to `com.ikenga.research`,
not here. Extends the **Pipeline-stages convention** (R-04) to the research
domain (`draft → review → validated`, terminal `archived`).

Three actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` / `interview`
  lifecycle action per D-02 (setup-in-chat); confirms monitored sources/cadences/
  default depth/owner with the operator in chat before writing
  `${CLAUDE_PROJECT_DIR}/.atelier/skill-research/manifest.json`.

- `research-sweep` (`ux_mode: approve`; triggers: manual + weekday 08:00 schedule)
  — reads `research_notes` via `host.dbQuery` (base columns: `id`, `title`,
  `entity_type`, `entity_name`, `entity_id`, `summary`, `source_urls`,
  `research_depth`, `tags`, `fit_score`, `status`, `researched_by`) and
  `research_sources` (when table exists); drafts stale-refresh proposals for
  monitored sources and stage-advance + hand-to-sales proposals for research notes;
  pauses for operator approval before any host write. Hand-to-sales proposals for
  validated prospect dossiers always carry `ux_mode: approve` (cross-domain commit).

- `draft-report` (`ux_mode: confirm`; trigger: manual) — gathers report fields in
  dock chat (D-02 — setup-in-chat pattern) for personas, competitor teardowns,
  prospect dossiers, market research, and DDEX digests; confirmed creation is
  written by the pane/host path; skill performs zero DB writes.

**Base-columns-only constraint observed:** `research-sweep` reads only current
`research_notes` base columns — never depends on the domain WP migration order.

**R-03 (Query-collapse):** no query actions; `research-sweep` is a sweep
proposal action, not a SELECT-shaped query surface.

**No web-scraping:** source re-scrape jobs are proposed in `research-sweep` and
dispatched by the host after operator approval. The skill never fetches.
