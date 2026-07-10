---
'@ikenga/pkg-outbound': patch
'@ikenga/pkg-finance': patch
'@ikenga/pkg-agent-ops': patch
---

Outbound: social media/hashtag edits now round-trip (queue + sent mappers read edited_json first, matching the newsletter mapper). Finance/agent-ops: drop the unused engine:invoke grant.
