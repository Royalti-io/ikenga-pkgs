# @ikenga/skill-research

**Research skill** — dispatch-only source-sweep, dossier-commission proposals, and report-draft surface for the Ikenga research domain.

## What this skill does

`skill-research` gives the operator (and research agents) three actions that work _against_ the live research knowledge base in `ikenga.db`, without owning any CRUD:

| Action | Mode | Trigger | One-liner |
|---|---|---|---|
| `setup` | `streaming` | manual | Configure the research pipeline for the current project: monitored sources, cadences, default depth, owner. Writes `.atelier/skill-research/manifest.json`. |
| `research-sweep` | `approve` | manual + weekday 08:00 | Read monitored sources and open research notes via `host.dbQuery`, surface stale-source refresh proposals and dossier-commission proposals with evidence, pause for operator approval before any host write. |
| `draft-report` | `confirm` | manual | Draft a new research report or dossier in the dock chat; confirmed creation is written by the pane/host path, not this skill. |

All three actions are **dispatch-only** per R4 — research CRUD belongs to `com.ikenga.research`, not here.

## State contract

- **Reads:** `host.dbQuery` (SELECT-only) — `research_notes`, `research_sources`.
- **Writes:** None from this skill. Approved sweep proposals dispatch through the host write path after the `approve` gate. Report creation from `draft-report` is written by the pane host, not the skill.
- **Instance config:** `${CLAUDE_PROJECT_DIR}/.atelier/skill-research/manifest.json` (written by `setup`).

## Research stage enum

`draft → review → validated` (with `archived` as the terminal stage).

- `draft`, `review`, `validated` are active stages.
- `archived` is a read-only terminal — no advance action crosses into it from this skill.

## Hand-to-sales dispatch (not production)

`skill-research` can propose a "Hand to sales" action for prospect dossiers (R-05/R-06 pattern). The proposal surfaces in the approve gate; the host/pane writes the cross-domain link to `sales_deals` on approval. `skill-research` never writes to `sales_deals` directly.

## Install

```bash
ikenga add @ikenga/skill-research
```

Requires `com.ikenga.skill-core` (resolved via the `requires` field in `manifest.json`).

## License

Apache-2.0 — [ikenga.dev](https://ikenga.dev)
