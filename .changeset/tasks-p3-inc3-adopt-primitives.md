---
"@ikenga/pkg-tasks": patch
---

P3 retrofit (increment 3): adopt the @ikenga/tokens app-kit primitives; delete the
33 KB tasks-css.js mirror's primitive bulk.

`scripts/build.mjs` now also vendors `@ikenga/tokens/app-kit-css` into `dist/lib/`
(the same deterministic copy as `tokens-css.js`), and `app.js` injects it in cascade
order tokens → app-kit → tasks-residue. The pixel-identical `.tk-*` primitives are
renamed to their canonical kit classes in the markup and their (now duplicate) rules
removed from `tasks.css`:

- `.tk-frame*` → `.frame*` (pkg-pane-frame)
- `.tk-det-head/topline/title/body` → `.ip-head/topline/title/body`, `.tk-desc` →
  `.ip-desc`, `.tk-progress` (+span) → `.ip-progress`/`.ip-progress-fill`,
  `.tk-action-bar` → `.ip-action-bar` (inspector-detail)
- `.tk-row` + children → `.dense-row.dense-row--task` + `.dense-row-{dot,body,title,right,due}`
- `.tk-badge` and `.tk-execmode` are byte-identical in the kit, so their tasks-local
  copies are removed (markup unchanged)

Conservative / pixel-exact: only primitives whose kit rule renders byte-identical to
the shipped `.tk-*` were adopted. The divergent ones stay as labelled domain residue
(the local button, filter bar, master/detail split shell, group divider, the inspector
field-grid / meta-row / timeline, and the inline feedback states), so there is no
visible delta. Verified live in the running shell (iyke before/after, dark + light;
the pane is density-insensitive) — pixel-identical.

`tasks.css`: 1048 → 774 lines; the regenerated `dist/lib/tasks-css.js` drops
33,453 → 26,542 bytes. Build is deterministic (`pnpm -r build && git diff --exit-code`).
