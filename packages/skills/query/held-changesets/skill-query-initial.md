---
"@ikenga/skill-query": minor
---

Initial release of `@ikenga/skill-query` (WP-24 — R-03 collapse).

Introduces the single cross-domain reader skill that closes R-03 permanently.
Five per-domain query surfaces from the C-level inventory (`pa-query`,
`ceo-query`, `cfo-query`, `cmo-query`, `sales-query`) are absorbed into one
`query` action that translates plain-English questions into parameterised
SELECTs over `ikenga.db`.

**One action: `query`** — `ux_mode: streaming`, `triggers: [manual]`.

- Inputs: `question` (required string), `domain?` (enum hint across 8 domains),
  `format?` (`brief | table | number`).
- Reads 15 tables across all Ikenga domains via `host.dbQuery` SELECT-only.
- Zero writes, zero dispatch — `host.dbExec` is never called from this skill.
- The manifest's `permissions["sqlite.tables"]` list is the complete audit
  surface; the SELECT-only constraint is enforced by package construction
  (grep: no INSERT/UPDATE/DELETE/DROP anywhere in the package).

Validates against the locked `ActionFrontmatter` Zod schema (WP-06).
`depends_on: ["skill-core"]` (G-04); `lift-requires --check` green.
`requires: [{ kind: "skill", name: "skill-core" }]` on manifest.

README absorption table names all five retired surfaces with their former
invoker and the single `query` action that now covers them. R-03 closed.
