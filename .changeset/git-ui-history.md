---
'@ikenga/pkg-git': minor
---

WP-08 — the History view: a paginated commit log with a hand-rolled commit
graph, a commit-detail inspector, and first-class `Co-Authored-By` attribution.

The graph is built, not bought. `@gitgraph/js` has been archived and unmaintained
since 2019, so `ui/src/views/history/graph-layout.ts` implements the
forbidden-columns algorithm (pvigier — the family behind gitk, GitKraken and
GitHub's own graph) over `%H %P`: for each commit, take the lowest column not
already carrying an edge that spans its row. First parents keep the mainline
straight, merge parents fork right and rejoin at the leftmost arriving lane, a
parent that isn't on the loaded page dangles off the bottom instead of being
dropped, and lanes are capped so a pathological repo can't push the commit text
off-pane. It imports nothing — a `CommitSummary[]` satisfies its input type as-is.

Paging is GitLens's shape: 500 commits, then 200 at a time, by `--skip`. The
whole layout is recomputed on append rather than patched, because a second page
resolves edges the first page could only dangle.

Attribution gets its own treatment because the data demands it: the
`Co-Authored-By` trailer is user-configurable and can be switched off, so its
absence is a real state and not evidence that anyone worked alone. Rows badge
the trailer when it's there; the detail pane always renders an attribution
block and says in words what an absent trailer does and does not mean. An
Attribution filter dims non-matching rows instead of removing them, so the one
true graph survives filtering.
