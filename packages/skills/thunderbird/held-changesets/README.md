# Held changesets — @ikenga/skill-thunderbird

These changesets are **intentionally held out of `.changeset/`** so the release
workflow does not publish `@ikenga/skill-thunderbird` yet.

`@ikenga/skill-thunderbird` is also marked `"private": true` in its
`package.json` — the only gate `changeset publish` actually honors (it filters on
`private`, not on the changeset `ignore` config). To resume publishing:

1. Move the changeset file from this directory back into `.changeset/`.
2. Remove `"private": true` from `package.json`.
3. Run the 3-copy mirror per the `skill-pa` `PUBLISHING.md` pattern.
