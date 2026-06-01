---
"@ikenga/skill-pa": minor
---

Author the skill-pa DISPATCH actions (WP-12). Four actions now carry complete,
validated frontmatter under `skills/pa/actions/`:

- `briefing` (`ux_mode: streaming`) — morning/EOD/weekly briefing; manual +
  weekday-morning schedule (`0 8 * * 1-5`); reads `ikenga.db` via `host.dbQuery`.
- `triage` (`ux_mode: approve`) — inbox/task triage producing draft decisions
  for the operator approve/edit/reject gate (E-11); manual + weekday schedule.
- `send` (`ux_mode: confirm`) — dispatch the approved email-drafts queue;
  operator confirms the send-list before the one narrow `host.dbExec` status write.
- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` lifecycle
  action; writes `${CLAUDE_PROJECT_DIR}/.atelier/skill-pa/manifest.json`.

All four declare `depends_on: ["skill-core"]`, carry zero CRUD verbs
(dispatch-only, R4 — task/email CRUD belongs to the tasks/mail pkgs), and keep
state on the local `ikenga.db` (no Supabase, no `supabase_tables` field). Each
validates against the locked `ActionFrontmatter` Zod and round-trips through the
WP-08 portability adapter to a Claude tool + a Mastra `createTool` stub
(70/70 bench assertions green).
