---
"@ikenga/skill-content": minor
---

Initial release of `@ikenga/skill-content` (WP-21a — scaffold + dispatch actions).

Introduces the content domain skill: pipeline-sweep with stage-advance proposals
and piece-draft for the content domain. **Dispatch-only per R4** — content CRUD
belongs to `com.ikenga.content`, not here. Extends the **Pipeline-stages
convention** (R-04) to the content domain (`idea → outline → draft → review →
scheduled`, terminal `published`).

Three actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` / `interview`
  lifecycle action per D-02 (setup-in-chat); confirms channels/series/cadence
  (blog · newsletter · social · video = tracking only) with the operator in chat
  before writing `${CLAUDE_PROJECT_DIR}/.atelier/skill-content/manifest.json`.

- `pipeline-sweep` (`ux_mode: approve`; triggers: manual + weekday 09:00 schedule)
  — reads `content_calendar` via `host.dbQuery` (pre-0047 base columns only: `id`,
  `type`, `channel`, `platform`, `title`, `status`, `assigned_to`, `publish_date`);
  drafts stage-advance proposals with evidence; flags stale pieces (>7 days in
  stage for `draft`/`review`; >14 days for `idea`/`outline`); pauses for operator
  approval before any host write.

- `draft-piece` (`ux_mode: confirm`; trigger: manual) — gathers piece fields in
  dock chat (D-02 — setup-in-chat pattern); confirmed creation is written by the
  pane/host path; skill performs zero DB writes.

**Mock contract 3 observed:** `pipeline-sweep` reads only pre-0047 base columns
from `content_calendar` — never depends on WP-21b's merge order.

**G-VIDEO-STACK (R23):** no video-production actions ship here; video channel is
tracking-only.

**R-03 (Query-collapse):** no query actions; `pipeline-sweep` is a sweep
proposal action, not a SELECT-shaped query surface.
