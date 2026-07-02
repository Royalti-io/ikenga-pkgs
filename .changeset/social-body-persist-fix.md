---
"@ikenga/pkg-outbound": patch
---

Fix Social editor silently discarding body edits on Approve: body now persists to
edited_json on blur and is flushed (blocking on failure) before the approve undo
countdown arms, so the committed draft always carries the text the user last saw.
