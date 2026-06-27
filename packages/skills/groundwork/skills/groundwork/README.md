<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# groundwork

**Research → design → plan → orchestrate → act, as a Claude Code skill.**

Groundwork turns "plan this" into a folder of living documents — a plan, research, a discussion log, a tracking file, and standalone HTML views — and gives you a small set of actions you can re-run any time. The defining property: **re-runs augment your work, they never overwrite it.** A checksum decides what changes on disk, not the model.

It's an open skill (Apache-2.0). It runs in plain Claude Code with nothing else installed, and because it ships in the open `npx skills` format it also works with Codex, Gemini, Cursor and other agents. The [Ikenga](https://ikenga.dev) shell is optional — it adds live in-shell views — but the skill, the folder, and the multi-agent kickoff all work without it.

## Install

```bash
npx skills add royalti-io/groundwork
```

Project install (committed with the repo). Add `-g` for a global install. Needs a Claude Code environment and Node ≥ 18.

## The folder

`groundwork init` interviews for a goal + profile and drops a domain-agnostic spine:

```
plans/my-feature/
├── .groundwork.json        ← identity + state anchor
├── 00-README.md
├── 01-plan.md
├── 02-research-external.md
├── 03-research-internal.md
├── 04-discussion.md        ← rounds, newest-first
├── 05-tracking.md          ← work packages + gates
├── 09-orchestration.md     ← generated multi-agent kickoff
└── artifact/
    ├── board.html          ← standalone plan board
    └── explorer.html       ← standalone file explorer (on `groundwork explorer`)
```

Every doc uses **generated-region fences** — actions write only inside them; your hand-authored prose is never touched. Stable IDs (`WP-NN`, `G-NN`, gates, `D-NN`) thread plan → tracking → orchestration → views, so re-syncs are deterministic, not guesswork.

## Actions

| Action | What it does |
| --- | --- |
| `init` | First-run interview (goal + profile); scaffolds the spine + `.groundwork.json`. |
| `research` | Researcher agent fills `02`/`03` in place. `--sweep` fans out finders via a Workflow. |
| `design` | Produces ≥2 comparable `designs/*.html` for the current phase; locks one. |
| `subplan` | Scaffolds a focused `NN-*.md` (diff-plan · decision-doc · bug-doc). |
| `review` | Reviewer agent appends a dated Round to `04`, allocates gap IDs, re-syncs by ID. `--panel` runs an adversarial panel. |
| `clarify` | Readiness gate before orchestrate. |
| `orchestrate` | Generates `09-orchestration.md` (waves, gates, briefs). `--emit-workflow` writes a runnable Workflow. |
| `refresh-board` | (Re)generates `artifact/board.html`. |
| **`explorer`** | (Re)generates `artifact/explorer.html` — a fully-offline file tree + tabbed viewer with search. |
| **`plans-index`** | (Re)generates `<plans-dir>/_index.html` — a cross-plan dashboard, one card per plan. |
| `status` | Read-only freshness + ID + design-coverage report. |

The core loop is **init → research → review → orchestrate**, with `review` re-run whenever the plan changes.

## Profiles

A profile swaps vocabulary and optional blocks without changing the spine: `software` (features/PRs), `general` (campaigns/org changes), `content` (editorial + key art), `design-system` (component/token libraries — adds a parts gallery + quality gate).

## Three HTML views

All three are self-contained Ikenga artifacts: they open standalone in any browser and light up with live status inside the Ikenga shell.

- **Board** (`artifact/board.html`) — Mission Control, Kanban, and dependency-graph views of one plan's execution state.
- **Explorer** (`artifact/explorer.html`) — a file tree + tabbed viewer (Markdown, live previews, images, code) with **full-text search**, profile-adaptive (gallery for `design-system`, media for `content`). **Fully offline** — React, the Markdown renderer, and the sanitizer are inlined and the view is pre-transpiled, so it runs air-gapped, in Claude Desktop, or as a bare upload with no network.
- **Plans index** (`<plans-dir>/_index.html`) — a cross-plan dashboard: one card per plan with a progress bar, drift indicator, and drill-in to each explorer / board.

### Tooling

The explorer and index are also scriptable for automation:

```bash
python3 scripts/generate_explorer.py --all-under plans/ --missing-only   # backfill every plan
python3 scripts/watch.py --plan plans/my-feature                          # live-refresh on change
node    scripts/build-offline-artifacts.mjs                               # rebuild the offline HTML from *.src.html
```

## How it works

The state machine (the `.groundwork.json` anchor, generated-region fences, the hash-diff that makes "augment, never overwrite" a guarantee) is specified in [`lib/state.md`](lib/state.md) and executed by the stdlib-only `scripts/groundwork_state.py`. Each action lives in its own file under [`actions/`](actions); `SKILL.md` is the router.

## Docs

- Full documentation: **[ikenga.dev/docs/groundwork](https://ikenga.dev/docs/groundwork)**
- The skill dogfoods itself — `plans/groundwork/` is the canonical worked example of every artifact in the spine.

## License

Apache-2.0.
