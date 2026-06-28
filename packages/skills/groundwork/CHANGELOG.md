# @ikenga/skill-groundwork

## 0.4.0

### Minor Changes

- [#36](https://github.com/Royalti-io/ikenga-pkgs/pull/36) [`e76c90b`](https://github.com/Royalti-io/ikenga-pkgs/commit/e76c90bfb4b468e8ac12a08cd21fe65d981ecac0) Thanks [@nedjamez](https://github.com/nedjamez)! - Add the file **explorer** + cross-plan **plans-index** views to the groundwork skill: a file tree + tabbed viewer with full-text search, profile-adaptive gallery/media, fully-offline self-contained artifacts (run air-gapped / in Claude Desktop), plus live-refresh and bulk-generate tooling. Also restores the forward `dev → pkgs → mirror` sync flow (the `sync-from-canonical` reversal rested on a fabricated source-of-truth sign-off).

## 0.3.1

### Patch Changes

- [#24](https://github.com/Royalti-io/ikenga-pkgs/pull/24) [`9764f1f`](https://github.com/Royalti-io/ikenga-pkgs/commit/9764f1f6afd24fa420f8687c551aa76c0056999c) Thanks [@nedjamez](https://github.com/nedjamez)! - Reverse the groundwork sync. The canonical source of truth is now the standalone repo `royalti-io/groundwork` (the same repo `npx skills add` installs from); this package holds a generated copy synced one-way from it via `pnpm sync:from-canonical`, purely for the npm publish. Retires the old forward flow (`sync-from-dev` + `build-mirror` force-push). The published skill tree is brought current with canonical (adds the design-system `quality-gate` template, updates `groundwork_state.py`, re-banners synced files to point at the canonical repo). Install path and npm identity are unchanged.

## 0.3.0

### Minor Changes

- [`7b6b519`](https://github.com/Royalti-io/ikenga-pkgs/commit/7b6b519be12cb6091a417862a34e469d5f9ac4ad) Thanks [@nedjamez](https://github.com/nedjamez)! - `init` now date-prefixes auto-derived plan folders as `plans/YYYY-MM-DD-<slug>/` so sibling plans sort chronologically; explicit paths the user passes are still used verbatim. The derived display title strips a leading `YYYY-MM-DD-` so dated folders don't carry the date into the artifact `<h1>`. The seeded-session fallback prompt (for sessions without the skill loaded) now also scaffolds the living-spec artifact (`artifact/index.html` + `artifact/manifest.json`) alongside the 6-doc spine.

## 0.2.0

### Minor Changes

- [#6](https://github.com/Royalti-io/ikenga-pkgs/pull/6) [`b4c5ba9`](https://github.com/Royalti-io/ikenga-pkgs/commit/b4c5ba938277532b68b0fd2c147d5537ddb1d391) Thanks [@nedjamez](https://github.com/nedjamez)! - Initial release of `@ikenga/skill-groundwork` — the canonical, ADR-009 home for the `groundwork` Claude Code skill (research → design → plan → orchestrate → act). The skill tree is synced one-way from the workspace dev source via `scripts/sync-from-dev.mjs` (every synced file carries a GENERATED banner; the dev copy stays the editable source of truth). `scripts/build-mirror.mjs` emits a standalone mirror-repo tree (package.json + install.sh + README + LICENSE + `skills/groundwork/`) that becomes the `npx skills add royalti-io/groundwork` install surface. A `PORTABILITY.md` ships inside the skill, disclosing the this-workspace `plans/studio` / `plans/groundwork` doc references and the standalone board's runtime fallbacks as a known, deferred limitation (document-don't-fix).
