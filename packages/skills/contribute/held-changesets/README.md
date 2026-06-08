# Held changesets — @ikenga/skill-contribute

These changesets are **intentionally held out of `.changeset/`** so the release
workflow does not publish `@ikenga/skill-contribute` yet.

The skill is also marked `"private": true` in its `package.json` — the only gate
`changeset publish` actually honors (it filters on `private`, not on the changeset
`ignore` config). To resume publishing (the publish WP, WP-11):

1. Move files from this directory into `.changeset/`.
2. Remove `"private": true` from `package.json`.
3. Run the publish-mirror step (see the sibling `../pa/PUBLISHING.md` pattern):
   build the `royalti-io/ikenga-contribute` mirror so `npx skills add
   royalti-io/ikenga-contribute` works, then run `registry-update.yml` so the
   Ọba catalog picks it up.
   - Note: CI npm publish is currently broken — use the local-publish workaround
     (`~/.npmrc` token + manual tag/gh-release) until `NPM_TOKEN` is restored.
