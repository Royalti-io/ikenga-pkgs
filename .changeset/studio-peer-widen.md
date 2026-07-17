---
"@ikenga/studio-archetypes": patch
"@ikenga/studio-toolchain": patch
---

Widen the `@ikenga/studio-schema` peer range to `^0.1.0 || ^0.2.0`. schema's
0.2.0 is purely additive (a new `./fountain` export subpath, nothing removed),
so the old `^0.1.0` range — which a caret excludes 0.2.0 from on 0.x — was
needlessly narrow and would have forced a spurious major bump on both packages
for a change that does not affect them.
