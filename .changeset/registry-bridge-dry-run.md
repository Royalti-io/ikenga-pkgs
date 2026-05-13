---
"@ikenga/pkg-engine-noop": patch
---

Test: exercise the publish→registry bridge end-to-end.

No functional change. This patch bump publishes `@ikenga/pkg-engine-noop@0.1.1`
and triggers `scripts/update-registry-index.mjs` for the first time, proving
the changesets/action → npm → registry-index pipeline works.
