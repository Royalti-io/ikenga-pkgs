# @ikenga/skill-groundwork

## 0.6.1

### Patch Changes

- [`e8ec1a6`](https://github.com/Royalti-io/ikenga-pkgs/commit/e8ec1a64749b0e026796e8cdcb88a8478f34d74d) Thanks [@nedjamez](https://github.com/nedjamez)! - Republish to get these five into the registry catalog.

  All five are on npm but absent from `index.json`, so `ikenga add` cannot see
  them. Registry membership is driven entirely by "appeared in a changesets
  publish AND has a manifest.json", and there is no backfill path other than
  publishing again — the index updater only ever acts on `publishedPackages`.

  Groundwork additionally could not have been catalogued even if it had been in
  a batch: it had no `manifest.json` at all, and its `files` list omitted the
  manifest so the tarball would not have carried one either. Both are fixed here;
  the manifest matches the shape its seven sibling skill pkgs use and validates
  against the contract's `ManifestSchema`.

  No functional change to any of the five — this is a version bump to give the
  release workflow something to publish.

## 0.6.0

### Minor Changes

- [#51](https://github.com/Royalti-io/ikenga-pkgs/pull/51) [`9ff3df5`](https://github.com/Royalti-io/ikenga-pkgs/commit/9ff3df501e7ce4b28a6785792378f1290ddf94ac) Thanks [@nedjamez](https://github.com/nedjamez)! - Make a research pass survive a truncated session.

  The `research` action folds findings into the fenced regions exactly once, at the
  end of the pass. That is correct for the `write-region` hash contract, but on its
  own it means a session that dies mid-pass loses every search the agent already
  ran, and the next run restarts from nothing. Web research is the most expensive
  thing groundwork does and the easiest to lose.

  The researcher now keeps a journal: it writes the file _before_ its first search
  and appends after every one, with a checkpoint summary every third search. Under
  `--sweep`, each angle gets its own journal so concurrent finders cannot clobber
  one another.

  The journal's existence is the signal. A journal present when the action starts
  means the previous pass never folded, so the action now offers to fold it as-is,
  resume from it, or discard — rather than silently overwriting it. It is deleted
  only after the fold has stamped successfully.

  **New on-disk side effect.** A research pass now creates
  `<plan_folder>/.research-journal-<scope>.md` in your plan folder, and leaves it
  there if the pass is interrupted. It is a dotfile that sits outside every
  `groundwork:auto` fence, so it is never hashed, stamped, or written into your
  spine documents — but if you track plan folders in git, add
  `.research-journal-*.md` to your ignore rules. The journal is transient by design
  and should not land in a commit.

  Also fixes two long-standing gaps in the researcher brief's declared substitution
  list: `{plan_folder}` has always been required by the brief but was never listed,
  and `{stamp}` joins it. The action substitutes `{stamp}` because a spawned agent
  cannot reliably read the clock.

## 0.5.0

### Minor Changes

- [#41](https://github.com/Royalti-io/ikenga-pkgs/pull/41) [`ae6b1b7`](https://github.com/Royalti-io/ikenga-pkgs/commit/ae6b1b7dab5fac6a220a185fec988db430135d5a) Thanks [@nedjamez](https://github.com/nedjamez)! - Add the `film` profile and make it discoverable.

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
