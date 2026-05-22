# @ikenga/studio · com.ikenga.studio

P1 video composition pkg for music labels. Pattern C iframe: pan/zoom
storyboard canvas, per-cell editor, composition timeline, archetype builder,
and script reader/editor — sharing a 4-value state (`cellUid`, `playheadMs`,
`hoverBeat`, `engineMode`) across all five views. HF-only renderer for P1;
Remotion engine slot locked behind P2; AI-gen behind P3.

## Status — WP-07 commit 1 (scaffold)

This commit is the build skeleton only:

- `package.json` declaring the workspace deps the iframe will need
- `vite.config.ts` (single-bundle output to `dist/`)
- `tsconfig.json` (React 19, ES2022, bundler resolution)
- `manifest.json` minimal subset — full manifest authored by WP-08
- `index.html` + `src/main.tsx` mount a placeholder
- `src/studio/styles/index.css` imports `@ikenga/tokens/tokens.css` so the
  iframe owns its own `var(--*)` namespace (the G21 fix)

Everything else — bridge, store, MCP mock, views, launcher, cross-linking,
DnD, a11y — lands in WP-07 commits 2–16. See
`plans/studio/10-wp07-iframe.md` for the full plan.

## Why a separate `shared/` directory shows up on disk

`packages/apps/studio/shared/` belongs to the `studio/wp02-schema` branch (the
`@ikenga/studio-schema` Zod schema, `c139ad1`). Its `dist/` and
`node_modules/` are gitignored here and only materialise when you check out
that branch. Once WP-02 merges to main, this README will reference the schema
package directly.

## Dependency caveat

`@ikenga/contract/canvas` (the pan/zoom primitive landed in WP-01) is not yet
on `contract@main` — the three `studio/wp01-canvas-extract` branches across
`contract`, `shell`, and this repo are code-complete + smoke-verified but not
merged. WP-07 commits 1–15 land via a local stub at
`src/studio/__stubs__/canvas.tsx`; commit 16 deletes the stub and swaps to the
real `@ikenga/contract/canvas` import once WP-01 ships. Anchor:
`plans/studio/.groundwork.json` → `ids.G-CANVAS`.

## Cross-refs

- Plan: `plans/studio/10-wp07-iframe.md` (WP-07 diff-plan)
- Design contract: `plans/studio/designs/*.html` (Round 5/8/9 locked set)
- Schema: `@ikenga/studio-schema` (WP-02, `c139ad1`, on `studio/wp02-schema`)
- Canvas: `plans/studio/06-canvas-extraction.md` (the gate commit 16 closes)
