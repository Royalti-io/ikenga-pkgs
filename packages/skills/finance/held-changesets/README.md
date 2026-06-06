# Held changesets — @ikenga/skill-finance

These changesets are **intentionally held out of `.changeset/`** so the release
workflow does not publish `@ikenga/skill-finance` yet.

Per the launch plan (WP-20a decision): skill-finance is held off the catalog
until it has its own publish WP, which must also run the 3-copy publish-mirror
step (not yet executed).

`@ikenga/skill-finance` is also marked `"private": true` in its `package.json` —
the only gate `changeset publish` actually honors (it filters on `private`, not
on the changeset `ignore` config). The same `private` gate is applied to the rest
of the held studio/skill suite. To resume publishing:

1. Move these files back into `.changeset/`.
2. Remove `"private": true` from `package.json` (here and any sibling held pkg
   you're publishing).
3. Run the 3-copy mirror per `../PUBLISHING.md` (if that file exists for this pkg).
