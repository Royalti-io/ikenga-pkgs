# @ikenga/skill-pa

PA dispatch skill for Ikenga — morning briefing, inbox/task triage, and
send-queue dispatch. **Dispatch-only** (R4): task and email CRUD belongs to
the tasks and mail pkgs.

## Install

```bash
npx skills add royalti-io/skill-pa   # coming in WP-14
```

Or via the Ikenga CLI once the 3-copy publish sync is wired (WP-14).

## What it does

| Action | Mode | Description |
|---|---|---|
| `briefing` | streaming | Morning / EOD / weekly briefing from tasks, calendar, email, agent-run state |
| `triage` | approve | Triage unhandled inbox + task queue; produce decisions for operator approval |
| `send` | confirm | Surface approved email-draft queue; dispatch on operator confirmation |
| `setup` | streaming | Configure skill-pa for the current project |

All state reads go through `host.dbQuery` (SELECT-only) against the local
`ikenga.db`. The one write path — marking sent drafts — goes through
`host.dbExec`, gated behind an `approve` ux_mode pause.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) (monorepo root).

## Phase

WP-11 skeleton. Action bodies land in WP-12. Publish sync lands in WP-14.
