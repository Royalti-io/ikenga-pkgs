---
'@ikenga/mcp-browser': minor
---

Phase 5 — pause/resume + richer `wait_for`.

- New tools `browser_pause` and `browser_resume`. When paused, the
  snapshot / interaction tools (`browser_snapshot`, `browser_click`,
  `browser_fill`, `browser_select`, `browser_press_key`,
  `browser_read_text`, `browser_wait_for`, `browser_eval`) refuse with
  HTTP 409. Navigation (`goto / back / forward / reload`), lifecycle
  (`close`), and `browser_list` still work — the pane stays interactive
  for the human user. Intended for "agent hit a captcha / MFA / dialog,
  hand off to the user, resume when they're done."
- `browser_wait_for.kind` gains `selector`, `gone-selector`, `gone-text`
  in addition to the existing `url / text / ref / idle`. Backed by a
  small in-page DOM check on each tick (existing 100ms cadence).
- `browser_list` results include `paused: boolean` so callers can detect
  state without a separate call.

Shell-side: new `set_paused / is_paused` methods on
`WebviewPanesRegistry`, two new HTTP routes (`/iyke/browser/pause` and
`/iyke/browser/resume`), and a `check_not_paused` guard wired into all
action handlers.
