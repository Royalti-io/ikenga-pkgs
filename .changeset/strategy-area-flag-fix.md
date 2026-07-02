---
"@ikenga/pkg-strategy": patch
---

Fix OKR board fallback grouping: strategic_initiatives.ties_to_goal is an INTEGER
0/1 flag, not an area name — flag-like values no longer become synthetic board
columns named "0"/"1"; they fall through to the Company area.
