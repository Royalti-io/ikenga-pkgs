# @ikenga/skill-content

**Content skill** — dispatch-only pipeline-sweep, stage-advance proposals, and piece-creation surface for the Ikenga content domain.

## What this skill does

`skill-content` gives the operator (and content agents) three actions that work _against_ the live editorial pipeline in `ikenga.db`, without owning any CRUD:

| Action | Mode | Trigger | One-liner |
|---|---|---|---|
| `setup` | `streaming` | manual | Configure the content pipeline for the current project: channels, series, cadence (blog · newsletter · social · video = tracking only). Writes `.atelier/skill-content/manifest.json`. |
| `pipeline-sweep` | `approve` | manual + weekday 09:00 | Read open content pieces via `host.dbQuery` (pre-0047 base columns only), surface stage-advance proposals with evidence, flag stale pieces, pause for operator approval before any host write. |
| `draft-piece` | `confirm` | manual | Draft a new content piece in the dock chat; confirmed creation is written by the pane/host path, not this skill. |

All three actions are **dispatch-only** per R4 — content CRUD belongs to `com.ikenga.content`, not here.

## State contract

- **Reads:** `host.dbQuery` (SELECT-only) — `content_calendar`, `social_queue`, `calendar_events`, `content_performance_history`.
- **Writes:** None from this skill. Approved stage-advance proposals dispatch through the host write path after the `approve` gate. Piece creation from `draft-piece` is written by the pane host, not the skill.
- **Instance config:** `${CLAUDE_PROJECT_DIR}/.atelier/skill-content/manifest.json` (written by `setup`).

## Content stage enum

`idea → outline → draft → review → scheduled` (with `published` as the terminal stage).

- `idea`, `outline`, `draft`, `review`, `scheduled` are active stages.
- `published` is a read-only terminal — no advance action crosses into it from this skill (the host writes it when a scheduled piece fires).

## Video tracking (not production)

`skill-content` tracks video pieces in the pipeline (stage, owner, due date) but does **not** produce, render, or schedule video. Video production belongs to `com.ikenga.studio` via the `G-VIDEO-STACK` decision (R23). The `video` channel appears in the pipeline as a tracking entry only.

## Install

```bash
ikenga add @ikenga/skill-content
```

Requires `com.ikenga.skill-core` (resolved via the `requires` field in `manifest.json`).

## License

Apache-2.0 — [ikenga.dev](https://ikenga.dev)
