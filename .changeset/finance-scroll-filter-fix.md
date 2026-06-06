---
"@ikenga/pkg-finance": patch
---

fix(finance): pane content now scrolls and the sidebar entity filter works.

- **Scroll**: add `height: 100%` to the root `.frame`. It mounts directly in `#root` without the `.frame-pane-slot` wrapper that supplies `flex: 1`, so the `.frame` had no bounded height and `.frame-body`'s `overflow-y: auto` never engaged — content overflowed the fixed `#root` and was clipped. Mirrors the working sales pane.
- **Filter**: the `activeFeature` effect only handled view ids and ignored the sidebar `ent-*` Accounts facet items, so the sidebar entity filter was dead. Route `ent-{all,royalti,dixtrit,personal}` → `setEntity`, and reflect the selected entity as the active menu item in `buildFinanceMenu`.
