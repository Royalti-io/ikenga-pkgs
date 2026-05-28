---
"@ikenga/skill-groundwork": minor
---

`init` now date-prefixes auto-derived plan folders as `plans/YYYY-MM-DD-<slug>/` so sibling plans sort chronologically; explicit paths the user passes are still used verbatim. The derived display title strips a leading `YYYY-MM-DD-` so dated folders don't carry the date into the artifact `<h1>`. The seeded-session fallback prompt (for sessions without the skill loaded) now also scaffolds the living-spec artifact (`artifact/index.html` + `artifact/manifest.json`) alongside the 6-doc spine.
