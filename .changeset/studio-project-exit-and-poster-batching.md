---
"@ikenga/pkg-studio": patch
---

Give an open project a way out, and stop the poster prefetch from degrading to N
solo fetches.

- **Project exit / switch (F-2).** `closeProject()` existed but had zero call
  sites and `Launcher` was published only in the no-project menu, so opening a
  project was a one-way door. `buildProjectMenu` now carries a "Close project"
  item (→ `closeProject()`) and a "Switch project" recents section (self-filtering
  the currently-open project), and the standalone App header title is a close
  button. The recents lifecycle was rewired so the switcher is populated even
  when an optimistic resume opens straight into a project. Both affordances
  converge on the verified `openProjectByPath` / `closeProject` paths — clicking
  "Close project" returns the board to the Launcher and republishes the
  no-project menu. (Cross-project switch-while-open is not yet live-verified —
  only one project was available on the test machine; the switcher reuses the
  same verified open path.)

- **Poster prefetch is authoritative now (Group F).** `prefetchPosters` issues
  one batched `render.list_posters`, but each `CellPoster`'s solo fetch flushed
  child→parent *before* Canvas's batch effect, so N single-id calls beat the
  batch (observed 8× on one board load). The card's solo fetch is now deferred a
  microtask so the batch reserves its ids first, collapsing the card's call to a
  no-op; genuine post-settle misses still solo-fetch. One board load is now
  +1 `render.list_posters`, +0 per-card `render.read_poster`.
