---
"@ikenga/skill-groundwork": minor
---

Add the `film` profile and make it discoverable.

`film` is a pre-production bible for shot-based work — short films, music videos,
trailers, AI-generated film. It carries its own vocabulary (sequence / scene + reel
/ picture lock) and optional blocks for treatment, lookbook, shotlist, shot tracker,
budget and schedule. It owns creative development and production management, and
hands execution off: `com.ikenga.studio` holds the authoritative per-shot render and
approval state, while `05-tracking.md` is a status mirror of that board. When the two
disagree, Studio wins.

Every LLM-facing surface now lists the profile (SKILL.md description + profile table +
file tree, the `init` interview, the seeded-session form, `lib/state.md`), with the
`content`-vs-`film` split spelled out as shot-based vs editorial. Without this the
`init` action never selected `film` — a filmmaking request scaffolded as `content`,
losing the shot ledger, the picture-lock gate and the Studio handoff.

Also included:

- Evals covering the profile: `film-profile-selection` (the discovery gap above) and
  `film-studio-boundary` (the mirror-not-shot-board rule).
- The profile-conformance test loop now covers `film` and `design-system`; it had
  silently never covered `design-system`.
- Forward-syncs an unrelated `plans-index` change already in the dev source since
  `561a96c`: an `openArtifact` host verb so in-shell artifact links open as a new tab
  in the focused pane (the viewer sandbox popup-blocks `target="_blank"`), falling back
  to same-frame navigation on older hosts. Disabled cards no longer navigate.
