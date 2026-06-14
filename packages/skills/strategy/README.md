# @ikenga/skill-strategy

**Strategy skill** — dispatch-only OKR review, countersign proposals, and objective-creation surface for the Ikenga strategy domain.

## What this skill does

`skill-strategy` gives the operator (and strategy agents) three actions that work _against_ the live OKR board in `ikenga.db`, without owning any CRUD:

| Action | Mode | Trigger | One-liner |
|---|---|---|---|
| `setup` | `streaming` | manual | Configure the strategy skill for the current project: active cycle, objective areas (Company · Growth · Product · Finance), owner agents, at-risk thresholds. Writes `.atelier/skill-strategy/manifest.json`. |
| `strategy-review` | `approve` | manual + Monday 09:00 | Read open objectives via `host.dbQuery`, surface countersign proposals with evidence, flag at-risk objectives, pause for operator approval before any host write. |
| `draft-objective` | `confirm` | manual | Draft a new objective in the dock chat; confirmed creation is written by the pane/host path, not this skill. |

All three actions are **dispatch-only** per R4 — strategy CRUD belongs to `com.ikenga.strategy`, not here.

## State contract

- **Reads:** `host.dbQuery` (SELECT-only) — `strategic_initiatives`, `architecture_decisions`, `ideas_backlog`, `feature_score_history`, `review_items` (existing); `strategy_objectives`, `strategy_key_results`, `strategy_cycles` (when created by the domain WP).
- **Writes:** None from this skill. Approved countersign proposals dispatch through the host write path after the `approve` gate. Objective creation from `draft-objective` is written by the pane host, not the skill.
- **Instance config:** `${CLAUDE_PROJECT_DIR}/.atelier/skill-strategy/manifest.json` (written by `setup`).

## Strategy ux-mode map

Per the strategy screen fixture (O-01..O-08):

| Mode | When | Examples |
|---|---|---|
| `approve` | Operator must countersign before external commit fires (E-11 gate) | O-02 countersign SAFE, O-06 approve DDEX GA checklist |
| `confirm` | Operator must confirm before agent proceeds | O-01 review metric, O-03 draft outreach, O-05 lock designs, O-08 resolve txns |
| `silent` | Agent acts autonomously on schedule; no operator button | O-04 auto-refresh forecast, O-07 nightly reconcile |

## Graceful degradation

`strategy-review` degrades gracefully when the schema-TBD tables (`strategy_objectives`, `strategy_key_results`, `strategy_cycles`) have not yet been created by the domain WP. In degraded mode it reads `strategic_initiatives` (existing) for the objectives sweep and `review_items` (existing, `content_type = 'strategy'`) for the review log, noting the fallback in the proposal header.

## Install

```bash
ikenga add @ikenga/skill-strategy
```

Requires `com.ikenga.skill-core` (resolved via the `requires` field in `manifest.json`).

## License

Apache-2.0 — [ikenga.dev](https://ikenga.dev)
