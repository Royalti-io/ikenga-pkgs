# Agent Ops

Ikenga pkg — **schedule observability** and **agent run history** over the
local `ikenga.db`. Multi-file iframe pkg, **no build step**. React 19 + htm +
TanStack Query via esm.sh.

| | |
|---|---|
| Pkg id | `com.ikenga.agent-ops` |
| Kind | `embedded` (UI iframe) |
| Surface | `/pkg/com.ikenga.agent-ops/` + deep-linkable sub-routes `/schedule` `/runs` `/failures` `/live` — all mount this same bundle; the pkg derives its initial view from the pane pathname and keeps the URL in sync on view change via `host.navigate`. The shell's `/cron` + `/agent-runs` routes deep-link here. |
| Data | ikenga.db `cron_job_runs` + `agent_runs` (WP-08 live; WP-07 uses FIXTURE) |
| Build | none — `dist/` is the whole app |
| License | Apache-2.0 (per ADR-009) |

## Layout

```
agent-ops/
├── manifest.json             # sqlite capability, tables: cron_job_runs, agent_runs
├── package.json
├── README.md
├── tsconfig.dev.json         # dev-only checkJs — NEVER in the publish path
└── dist/                     # kernel convention — iframe sources live here
    ├── index.html            # mount point; imports app.js as ES module
    ├── app.js                # bridge + theme mirror + QueryClient → mounts <ScheduleView/>
    ├── lib/
    │   ├── view-model.js     # G-VIEW contract (FROZEN) + FIXTURE + validators
    │   ├── ui.js             # React, ReactDOM, htm, TanStack Query (esm.sh) + Icon/Button/cn
    │   ├── bridge.js         # @modelcontextprotocol/ext-apps wrapper (tagged [agent-ops])
    │   ├── tokens-css.js     # @ikenga/tokens CSS-as-JS-string
    │   └── agent-ops-css.js  # pane CSS-as-JS-string (lifted from D-01 mock, shell chrome stripped)
    └── features/schedule/
        └── schedule-view.js  # Schedule / Runs / Failures / Live views + setMenu
```

## Views (WP-07)

- **Schedule** — KPI strip, namespace-bucketed 12-hour timeline, job table with
  sparkline bars, run-now confirm modal (G-13: billable vs script), empty/
  daemon-down states (G-14). Renders `FIXTURE` from `lib/view-model.js`.
- **Runs** — placeholder (WP-11)
- **Failures** — placeholder (WP-13)
- **Live** — placeholder (WP-13)

The side-menu (Views + Filters, Ngwa-style) is published via `host.pkg.setMenu`.
Filters dim on Runs/Live/Failures (list-only, mirrors tasks-pkg `filtersInert`).

## Data (WP-07 → WP-08)

WP-07: all data comes from `FIXTURE` in `lib/view-model.js`.

WP-08 will swap in live ikenga.db reads via `hostDbQuery`. The swap point is
`schedule-view.js` at the `// WP-08: replace FIXTURE with hostDbQuery(...)` marker.

## G-VIEW contract

`lib/view-model.js` is **frozen** (G-VIEW gate). It defines `ScheduleData`,
`JobView`, `RunView`, `AgentRunView`, `ExternalSchedulerView` typedefs and the
`FIXTURE` mock. All views pin to this contract. Do not change it without a
multi-WP re-sync.

## CSP

`manifest.json` declares `ui.csp` overrides allowing:

- `script-src` / `style-src` / `font-src`: `https://esm.sh`
- `connect-src`: `https://esm.sh`

See [`docs/pkg-patterns/01-ui-iframe.md`](../../../../docs/pkg-patterns/01-ui-iframe.md).
