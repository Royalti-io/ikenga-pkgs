# Held changesets — @ikenga/skill-query

These changesets are **intentionally held out of `.changeset/`** so the release
workflow does not publish `@ikenga/skill-query` yet.

Per the launch plan (WP-24 / WP-30 decision): skill-query is held off the
catalog until it has its own publish WP, which is now just a marketplace
entry — the 3-copy mirror model was retired (see ikenga-pkgs#66).

`@ikenga/skill-query` is also marked `"private": true` in its `package.json` —
the only gate `changeset publish` actually honors (it filters on `private`, not
on the changeset `ignore` config). The same `private` gate is applied to the
rest of the held studio/skill suite. To resume publishing:

1. Move these files back into `.changeset/`.
2. Remove `"private": true` from `package.json` (here and any sibling held pkg
   you are publishing).
3. No mirror step — this skill reads `ikenga.db` via `host.dbQuery` and
   ships with the shell rather than through the marketplace.
