# Held changesets — @ikenga/skill-content

These changesets are **intentionally held out of `.changeset/`** so the release
workflow does not publish `@ikenga/skill-content` yet.

Per the launch plan: skill-content is held off the catalog until it has its own
publish WP, which must also run the 3-copy publish-mirror step in the sibling
`../pa/PUBLISHING.md` pattern (not yet executed).

`@ikenga/skill-content` is also marked `"private": true` in its `package.json` —
the only gate `changeset publish` actually honors (it filters on `private`, not
on the changeset `ignore` config). To resume publishing:

1. Move files from this directory into `.changeset/`.
2. Remove `"private": true` from `package.json`.
3. Run the 3-copy mirror per `../pa/PUBLISHING.md`.
