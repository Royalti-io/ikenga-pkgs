---
"@ikenga/pkg-outbound": patch
---

Body editors auto-grow to their content (social base-body, email edit panel) —
no more fixed 180px/6-row boxes with inner scrollbars; the detail pane scrolls
as one document. Ships via a new pkg-runtime useAutoGrow hook.
