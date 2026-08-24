# Held changesets — @ikenga/skill-contribute

These changesets are **intentionally held out of `.changeset/`** so the release
workflow does not publish `@ikenga/skill-contribute` yet.

The skill is also marked `"private": true` in its `package.json` — the only gate
`changeset publish` actually honors (it filters on `private`, not on the changeset
`ignore` config). To resume publishing (the publish WP, WP-11):

1. Move files from this directory into `.changeset/`.
2. Remove `"private": true` from `package.json`.
3. Add an entry to `.claude-plugin/marketplace.json` in
   [`ikenga-hq/marketplace`](https://github.com/ikenga-hq/marketplace) so users
   can `/plugin install ikenga-contribute@ikenga`.
   - The `ikenga-hq/ikenga-contribute` mirror already exists and stays live —
     its `npx skills add` line is published externally — but no *new* mirror
     needs building. The 3-copy model was retired (see ikenga-pkgs#66).
