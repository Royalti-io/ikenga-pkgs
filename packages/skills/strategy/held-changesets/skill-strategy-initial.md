---
"@ikenga/skill-strategy": minor
---

Initial release of `@ikenga/skill-strategy` (WP-23a — scaffold + dispatch actions).

Introduces the strategy domain skill: OKR review with countersign proposals and
objective-draft for the strategy domain. **Dispatch-only per R4** — strategy CRUD
belongs to `com.ikenga.strategy`, not here. Extends the **Pipeline-stages
convention** (R-04) to the strategy domain with the three ux-mode types from the
strategy screen fixture (O-01..O-08): `silent` (auto-agent), `confirm`
(operator-gate), `approve` (E-11 countersign gate).

Three actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` / `interview`
  lifecycle action per D-02 (setup-in-chat); confirms active cycle, objective
  areas (Company · Growth · Product · Finance), owner agents, at-risk thresholds,
  and review schedule with the operator in chat before writing
  `${CLAUDE_PROJECT_DIR}/.atelier/skill-strategy/manifest.json`.

- `strategy-review` (`ux_mode: approve`; triggers: manual + Monday 09:00 schedule)
  — reads `strategic_initiatives`, `architecture_decisions`, `ideas_backlog`,
  `feature_score_history`, and `review_items` via `host.dbQuery`; also reads
  `strategy_objectives`, `strategy_key_results`, and `strategy_cycles` when
  available (schema TBD — created by the domain WP on first launch); drafts
  countersign proposals with evidence, flags at-risk objectives (< 50% progress
  after > 30 days elapsed); pauses for operator approval before any host write.
  Graceful degradation to existing tables when schema-TBD tables are absent.

- `draft-objective` (`ux_mode: confirm`; trigger: manual) — gathers objective
  fields (title, area, cycle, owner, ux_mode, next_action, KRs) in dock chat
  (D-02 — setup-in-chat pattern); confirmed creation is written by the pane/host
  path; skill performs zero DB writes.

**Strategy ux-mode map (business rules, strategy.md O-01..O-08):**
- `approve` (E-11 gate) — O-02 (countersign SAFE), O-06 (approve DDEX GA checklist)
- `confirm` — O-01, O-03, O-05, O-08 (operator confirms before agent proceeds)
- `silent` — O-04, O-07 (agent acts autonomously on schedule; no operator button)

**R-03 (Query-collapse):** no query actions; `strategy-review` is a sweep
proposal action, not a SELECT-shaped query surface.
