# actions/

Each file here is one `skill-pa` action. Action bodies land in WP-12.

| File | Action | ux_mode | Status |
|---|---|---|---|
| `briefing.md` | `briefing` | `streaming` | authored — WP-12 |
| `triage.md` | `triage` | `approve` | authored — WP-12 |
| `send.md` | `send` | `confirm` | authored — WP-12 |
| `setup.md` | `setup` | `streaming` | authored — WP-12 |

Every action must carry YAML frontmatter that validates against
`ActionFrontmatter` (the locked Zod in
`plans/atelier/drafts/action-frontmatter.ts`). Key constraints:

- `depends_on: ["skill-core"]` only — no other target is legal (G-04 lint).
- `requires_capabilities` must list `sqlite` for any action that reads/writes
  `ikenga.db`.
- `ux_mode` must be one of: `confirm | silent | form | streaming | approve`.
- `triggers[]` may include `manual | schedule | webhook | event`; empty = manual-only.
- No `supabase_tables` field — table scope is declared in `manifest.json`, not
  here (G-18; `.strict()` rejects it as an unknown key).

See `lib/state.md` for the full table-scope and read/write boundary that every
action in this directory obeys.
