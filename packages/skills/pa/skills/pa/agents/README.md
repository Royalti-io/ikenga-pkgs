# agents/

Agent brief templates used by skill-pa actions. Bodies land in WP-12.

| File | Role | Used by |
|---|---|---|
| `pa-dispatcher.md` | The PA dispatcher agent brief — reads state, produces triage/briefing/send outputs | `briefing`, `triage`, `send` actions |

## Conventions

Agent files in this directory are **brief templates** — prose the action seeds a
subagent with (or that `host.startChatSession` passes at session start). They are
NOT runnable skill files. Each file should:

1. Open with the agent's role and single responsibility.
2. List the `host.dbQuery` selects the agent is allowed to issue (table + columns,
   SELECT-only for all except `send` which also uses `host.dbExec` on `email_drafts`).
3. Declare the output shape (structured YAML / JSON the action surfaces for approval).
4. Reference the relevant `ActionFrontmatter` fields (`ux_mode`, `requires_capabilities`).

See `lib/state.md` for the full table-scope + read/write boundary.
