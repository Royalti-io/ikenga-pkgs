# @ikenga/pkg-research — `com.ikenga.research`

The **Research** domain pkg — Ikenga's knowledge surface. A no-build srcdoc
iframe pkg built on the atelier app-kit (the same pattern as `com.ikenga.tasks`
and `com.ikenga.content`).

Three views, all driven by the **shell side-menu** (not in-pane tabs):

| View | Shape | Data |
|------|-------|------|
| **Reports** | list + detail split (`.ip-split`, `--ip-list-w: 380px`) | `research_notes` |
| **Sources** | dense monitored-source register table | `research_sources` |
| **Personas** | 2-up ICP card grid (`.rs-persona-*`) | local fixture (ICP grid) |

## Architecture (the 8-step recipe)

See `plans/atelier-design-system/08-pkg-retrofit-recipe.md` and
`plans/atelier-design-system/parts/screens/research.md`.

1. **Manifest** — `capabilities.sqlite.db: "ikenga.local"`;
   `permissions.sqlite.tables: [research_notes, research_sources, sales_deals]`
   (research reads `research_notes` + `research_sources`; `sales_deals` is the
   write target for the cross-domain "Hand to sales" link).
2. **CSS vendoring** — `scripts/build.mjs` copies `tokens-css.js` + `app-kit-css.js`
   from `@ikenga/tokens` and codegens `research-css.js` from `dist/research.css`.
3. **Inject order** — `tokens → app-kit → research` (inline `<style>`; `<link>`/
   `@import` fail inside the shell's `about:srcdoc`).
4. **Appearance mirror** — `setupTheme()` copied verbatim from `tasks`; mirrors the
   four parent `<html>` attrs. `data-workspace="agents"` static (teal tint).
5. **Kit primitives + slim residue** — kit classes from the start; only `.rs-*`
   residue (persona grid, source register, freshness pill, cross-domain badge,
   Fit bar) + the `.ux-dot.ux-*` mode-dot colours live in `research.css`.
6. **Data** — `host.dbQuery` / `host.dbExec` only; TanStack Query; refresh on
   `db-updated`.
7. **Side-menu publish** — `setMenu()` keyed on `[activeView, reports]`. The
   "By type" filter group dims (`disabled`) on Sources / Personas (R23 list-only).
8. **Migration** — `0053_research_domain.sql` (registered by the shell migration
   runner): extends `research_notes` (`next_action`, `next_action_target`,
   `agent_cycle_id`, `is_stale`, `word_count`, `owner`), creates `research_sources`,
   adds `sales_deals.research_item_id` (soft TEXT link, no FK).

## Provisional fallback (before 0053 lands)

The pane renders against real `research_notes` from day one:
- `word_count` derives from `body` length when the column is absent/empty.
- `research_sources` reads fall back to the canonical fixture register.
- Hand-to-sales prefers `UPDATE sales_deals SET research_item_id = ?`; falls back
  to appending the link into `sales_deals.notes` when the column doesn't exist yet.

## Build

```bash
node scripts/build.mjs   # vendors tokens + app-kit, regenerates research-css.js
```

`dist/lib/tokens-css.js` and `dist/lib/app-kit-css.js` are git-ignored (vendored
from `@ikenga/tokens@^0.3.0`); `dist/lib/research-css.js` is regenerated from
`dist/research.css` (the source of truth).

## License

Apache-2.0 (per ADR-009).
