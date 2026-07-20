---
'@ikenga/pkg-studio': minor
---

Breakdown board thumbs now show the real rendered frame for any shot with a
finished render, instead of the ember-glow placeholder.

Reuses the poster seam Canvas already uses — `CellPoster` for the image and
`prefetchPosters` for a single batched `render.list_posters` round trip on the
done-render ids. Because the prefetch is driven off `shot.record`, which is
done-only, it never asks for frames that have not finished. The shot-type label
is layered above the frame so it stays legible against real imagery.
