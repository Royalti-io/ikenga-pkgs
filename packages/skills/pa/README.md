# @ikenga/skill-pa

PA dispatch skill for Ikenga — morning briefing, inbox/task triage, and
send-queue dispatch. **Dispatch-only** (R4): task and email CRUD belongs to
the tasks and mail pkgs.

## Install

```bash
npx skills add ikenga-hq/skill-pa   # coming in WP-14
```

Or via the Ikenga CLI once the 3-copy publish sync is wired (WP-14).

## What it does

| Action | Mode | Description |
|---|---|---|
| `briefing` | streaming | Morning / EOD / weekly briefing from tasks, calendar, email, agent-run state |
| `triage` | approve | Triage unhandled inbox + task queue; produce decisions for operator approval |
| `send` | confirm | Surface approved **mail-reply** draft queue; dispatch on operator confirmation. **Non-outbound only (R22)** — newsletter/campaigns/sequences/social dispatch is owned by `@ikenga/skill-outbound send`. |
| `setup` | streaming | Configure skill-pa for the current project |

All state reads go through `host.dbQuery` (SELECT-only) against the local
`ikenga.db`. The one write path — marking sent drafts — goes through
`host.dbExec`, gated behind an `approve` ux_mode pause.

## R22 send-boundary note

**Round 22 founder decision:** `skill-pa send` is scoped to **mail replies only**
(drafts produced by `triage-inbox` / `draft-reply` in the mail flow — rows in
`email_drafts` where `source = 'mail-reply'`). All outbound-channel dispatch
(newsletter, email campaigns, drip sequences, social posts) is owned by
**`@ikenga/skill-outbound send`** (`packages/skills/outbound/`). The boundary is
enforced by the `email_drafts.source` / `delivery_system` column at query time.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) (monorepo root).

## Phase

WP-11 skeleton. Action bodies land in WP-12. Publish sync lands in WP-14.
