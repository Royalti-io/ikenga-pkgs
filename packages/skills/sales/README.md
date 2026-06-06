# @ikenga/skill-sales

**Sales skill** — dispatch-only pipeline-sweep, stage-advance proposals, and deal-creation surface for the Ikenga sales domain.

## What this skill does

`skill-sales` gives the operator (and `sales-agent`) three actions that work _against_ the live sales pipeline in `ikenga.db`, without owning any CRUD:

| Action | Mode | Trigger | One-liner |
|---|---|---|---|
| `setup` | `streaming` | manual | Configure the sales pipeline for the current project: stage enum, win-probability defaults, and quarter target. Writes `.atelier/skill-sales/manifest.json`. |
| `pipeline-sweep` | `approve` | manual + weekday 08:00 | Read open deals via `host.dbQuery`, surface next-action proposals (with evidence), flag stale deals, pause for operator approval before any host write. |
| `draft-deal` | `confirm` | manual | Draft a new deal in the dock chat; confirmed creation is written by the pane/host path, not this skill. |

All three actions are **dispatch-only** per R4 — deal CRUD belongs to `com.ikenga.sales`, not here.

## State contract

- **Reads:** `host.dbQuery` (SELECT-only) — `sales_deals`, `sales_activities`, `sales_lead_scores`, `contacts`, `sales_stage_transitions`.
- **Writes:** None from this skill. Approved stage-advance proposals dispatch through the host write path after the `approve` gate. Deal creation from `draft-deal` is written by the pane host, not the skill.
- **Instance config:** `${CLAUDE_PROJECT_DIR}/.atelier/skill-sales/manifest.json` (written by `setup`).

## Install

```bash
ikenga add @ikenga/skill-sales
```

Requires `com.ikenga.skill-core` (resolved via the `requires` field in `manifest.json`).

## License

Apache-2.0 — [ikenga.dev](https://ikenga.dev)
