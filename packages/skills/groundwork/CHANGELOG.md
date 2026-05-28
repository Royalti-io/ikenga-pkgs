# @ikenga/skill-groundwork

## 0.3.0

### Minor Changes

- [`7b6b519`](https://github.com/Royalti-io/ikenga-pkgs/commit/7b6b519be12cb6091a417862a34e469d5f9ac4ad) Thanks [@nedjamez](https://github.com/nedjamez)! - `init` now date-prefixes auto-derived plan folders as `plans/YYYY-MM-DD-<slug>/` so sibling plans sort chronologically; explicit paths the user passes are still used verbatim. The derived display title strips a leading `YYYY-MM-DD-` so dated folders don't carry the date into the artifact `<h1>`. The seeded-session fallback prompt (for sessions without the skill loaded) now also scaffolds the living-spec artifact (`artifact/index.html` + `artifact/manifest.json`) alongside the 6-doc spine.

## 0.2.0

### Minor Changes

- [#6](https://github.com/Royalti-io/ikenga-pkgs/pull/6) [`b4c5ba9`](https://github.com/Royalti-io/ikenga-pkgs/commit/b4c5ba938277532b68b0fd2c147d5537ddb1d391) Thanks [@nedjamez](https://github.com/nedjamez)! - Initial release of `@ikenga/skill-groundwork` — the canonical, ADR-009 home for the `groundwork` Claude Code skill (research → design → plan → orchestrate → act). The skill tree is synced one-way from the workspace dev source via `scripts/sync-from-dev.mjs` (every synced file carries a GENERATED banner; the dev copy stays the editable source of truth). `scripts/build-mirror.mjs` emits a standalone mirror-repo tree (package.json + install.sh + README + LICENSE + `skills/groundwork/`) that becomes the `npx skills add royalti-io/groundwork` install surface. A `PORTABILITY.md` ships inside the skill, disclosing the this-workspace `plans/studio` / `plans/groundwork` doc references and the standalone board's runtime fallbacks as a known, deferred limitation (document-don't-fix).
