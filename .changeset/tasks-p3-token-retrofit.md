---
"@ikenga/pkg-tasks": patch
---

P3 retrofit (increment 1): consume the reconciled @ikenga/tokens; drop the aliasCss shim.

`dist/lib/tokens-css.js` is updated to @ikenga/tokens@0.3.0 (the atelier-design-system
P0 reconciliation — warm `--live`/`--agent`, `--live-fg`, `data-density`, motion,
Fraunces/Inter). With those tokens defined natively, the hand-maintained `aliasCss`
shim in `app.js` (`--live`→`--success`, `--font-body`→`--font-sans`, `--motion-fast:120ms`, …)
is no longer needed and is removed. Verified rendering in the running shell (Dusk Wood;
`--live` green / danger / systemic all resolve correctly).

Follow-up (increment 2): automate the tokens vendoring (build-time copy from
`@ikenga/tokens/dist`) and adopt the app-kit primitives (replace the tasks.css `.tk-*`
primitives with the kit + a slim domain residue).
