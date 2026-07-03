# @ikenga/pkg-runtime

Single source of truth for the no-build iframe runtime that the app pkgs
(`packages/apps/*`) used to carry as ~2,600 LOC of copy-pasted `dist/lib/`
files. Extracted in **WP-19**.

Not published to npm (private). Each consuming pkg's `scripts/build.mjs` calls
`vendorRuntime(...)` from `./vendor.mjs` to **copy** these modules into its own
`dist/lib/` so the served `dist/` stays self-contained (about:srcdoc iframes
cannot import across packages at runtime).

## Modules

| File | Role | Notes |
|------|------|-------|
| `bridge.js` | MCP Apps SDK iframe⇄host bridge (core) | **Byte-identical across pkgs.** Per-pkg source-id + log tag come from the generated sibling `pkg-id.js` (`PKG_ID`, `LOG_TAG`) — imported, not inlined. This kills the copy-paste-id bug class. |
| `bridge.ext.outbound.js` | outbound's `host.fetch` + approve-gate verbs | Concatenation **fragment** appended after the core; relies on the core's module-scoped `app` + `LOG_TAG`. Not a standalone module. |
| `bridge.ext.agentops.js` | agent-ops' `host.agentOps.*` cron verbs | Same fragment contract as above. |
| `ui.js` | React 19 + htm + TanStack Query boot, `cn`, `Button`, `Icon` | **Byte-identical across pkgs.** Carries the **union** of every pkg's icon glyphs (57). |
| `dispatch.js` | recipe: item next-action → `host.sendToActiveSession` | verbatim shared |
| `create-dispatch.js` | recipe: create-brief dispatch | verbatim shared |
| `facet-filter.js` | recipe: facet filter helpers (pure) | verbatim shared |

## Editing

Edit **here**, then re-run the affected pkg's build (`node scripts/build.mjs`)
to re-vendor. Never hand-edit a pkg's `dist/lib/{bridge,ui,dispatch,...}.js` —
those are generated and will be overwritten. Guard drift in CI with
`pnpm -r build && git diff --exit-code`.

Per-pkg wiring (which modules + identity each pkg vendors) is recorded in
`runtime.manifest.json` under `consumers`.
