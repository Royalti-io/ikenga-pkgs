---
"@ikenga/skill-sales": minor
---

Initial release of `@ikenga/skill-sales` (WP-18a — scaffold + dispatch actions).

Introduces the sales domain skill: pipeline-sweep with stage-advance proposals
and deal-draft for the sales domain. **Dispatch-only per R4** — deal CRUD belongs
to `com.ikenga.sales`, not here. The first consumer of the **Pipeline-stages
convention** (R-04, resolved at wave-2 entry, Round 22).

Three actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` / `interview`
  lifecycle action per D-02 (setup-in-chat); confirms stage enum (lead →
  qualified → proposal → negotiation → closing → won | lost), win-probability
  defaults per stage, and quarter target with the operator in chat before writing
  `${CLAUDE_PROJECT_DIR}/.atelier/skill-sales/manifest.json`.

- `pipeline-sweep` (`ux_mode: approve`; triggers: manual + weekday 08:00 schedule)
  — reads open deals from `ikenga.db` via `host.dbQuery` using **pre-0043 base
  columns only** (`stage`, `value`, `score`, `last_contact`, `assigned_to`);
  produces next-action proposals with evidence; **flags deals stuck > 30 days in
  their current stage** (business rule from the sales screen doc); pauses for
  operator approval (E-11 gate) before any host write. Stage-advance proposals
  carry `ux_mode` per the Pipeline-stages convention (§R-04): `silent` for
  intra-stage agent moves, `confirm` for operator one-offs, `approve` for
  terminal-crossing or outward dispatch. Approved moves dispatch through the host
  write path — the skill itself never writes to the DB.

- `draft-deal` (`ux_mode: confirm`) — deal-creation in the dock chat (the sales
  screen "Add deal" key action, D-02 pattern); the pane/host path writes the row.
  No CRUD in the skill.

All three actions declare `depends_on: ["skill-core"]`, carry zero CRUD verbs
(dispatch-only, R4), keep state on the local `ikenga.db` (no Supabase, no
`supabase_tables` field), and validate against the locked `ActionFrontmatter`
Zod (WP-06).

Manifest: `id: "com.ikenga.skill-sales"`, `kind: "skill"`,
`capabilities.sqlite.db: "ikenga.local"`,
`permissions["sqlite.tables"]: ["sales_deals","sales_activities","sales_forecasts","sales_lead_scores","sales_stage_transitions","contacts"]`,
`requires: [{kind:"skill", name:"skill-core"}]` — no `skills` field.

SQL in `pipeline-sweep` is verified to touch only pre-0043 base columns:
`stage`, `value`, `score`, `last_contact`, `assigned_to`.
