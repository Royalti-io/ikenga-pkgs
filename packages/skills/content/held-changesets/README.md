# Held changesets — @ikenga/skill-content

These changesets are **intentionally held out of `.changeset/`** so the release
workflow does not publish `@ikenga/skill-content` yet.

Per the launch plan: skill-content is held off the catalog until it has its own
publish WP, which is now just a marketplace entry — the 3-copy mirror model was retired
(see ikenga-pkgs#66).

`@ikenga/skill-content` is also marked `"private": true` in its `package.json` —
the only gate `changeset publish` actually honors (it filters on `private`, not
on the changeset `ignore` config). To resume publishing:

1. Move files from this directory into `.changeset/`.
2. Remove `"private": true` from `package.json`.
3. No mirror step — this skill reads `ikenga.db` via `host.dbQuery` and
   ships with the shell rather than through the marketplace.
