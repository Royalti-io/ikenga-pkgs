---
"@ikenga/pkg-content": minor
---

WP-21b: Add `com.ikenga.content` domain pkg — Pipeline (kanban default + list toggle), Calendar, Published views over `content_pieces` / `content_calendar` / `social_queue` / `calendar_events`. Owns migration 0047_content_domain.sql (STRICT, no FK). Implements the `kind:'seg'` contract (second consumer after sales).
