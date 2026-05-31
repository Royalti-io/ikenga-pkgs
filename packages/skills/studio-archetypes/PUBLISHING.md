# PUBLISHING — @ikenga/studio-archetypes

> **Status: WP-22 naming reconciliation DONE — not yet published.**
> The package on this page is scaffolded, validated, and naming-reconciled.
> The commands below have NOT been run. npm publish and mirror-repo creation
> are the explicit supervised follow-up that must be run by the maintainer in
> a gated session (same gate as `@ikenga/skill-pa`).

---

## Bundle overview

`studio-archetypes` is a **bundle** (`kind: "bundle"` in manifest.json). A bundle
is a single publish unit that installs multiple member skills in one operation.
The skills CLI resolves `kind: "bundle"` by running `skills add --skill '*'` which
installs all members from the bundle's `skills/` directory.

Members shipped in this bundle (9 skills):

| Member slug | Skills dir |
|---|---|
| `animation-patterns` | `skills/animation-patterns/` |
| `archetype-ai-short` | `skills/archetype-ai-short/` |
| `archetype-explainer` | `skills/archetype-explainer/` |
| `archetype-montage` | `skills/archetype-montage/` |
| `archetype-music-video` | `skills/archetype-music-video/` |
| `archetype-narrative` | `skills/archetype-narrative/` |
| `archetype-product` | `skills/archetype-product/` |
| `archetype-tutorial` | `skills/archetype-tutorial/` |
| `studio-core-blocks` | `skills/studio-core-blocks/` |

The catalog entry (`primitives.json`) for this bundle will carry
`kind: "bundle"` and a `members[]` array derived at publish (WP-23).

---

## The 3-copy sync

`studio-archetypes` travels through three copies before a user can install it
via the Ikenga skills CLI, exactly like `skill-pa` and `skill-groundwork`.

```
Copy 1  ikenga/.claude/skills/studio-archetypes/  ← dev source (workspace dogfood)
   ↓    node ./scripts/sync-from-dev.mjs
Copy 2  ikenga-pkgs/packages/skills/studio-archetypes/  ← canonical (this repo; Changesets-versioned)
   ↓    node ./scripts/build-mirror.mjs
Copy 3  dist-mirror/                                      ← staged mirror tree (local only)
   ↓    git push royalti-io/studio-archetypes
Mirror  github.com/royalti-io/studio-archetypes          ← public mirror (install target)
```

For the initial publish, Copy 2 (this directory) is the authoritative source;
`sync-from-dev` becomes relevant on subsequent edit→publish cycles. Author
`scripts/sync-from-dev.mjs` + `scripts/build-mirror.mjs` modelled on the
`skill-pa` / `skill-groundwork` equivalents (change `SKILL_NAME = 'studio-archetypes'`,
`SKILL_SLUG = 'studio-archetypes'`, `MIRROR_REPO = 'royalti-io/studio-archetypes'`,
and the `--src` path to `ikenga/.claude/skills/studio-archetypes/`).

The package's `files` field controls what ships to npm:

```json
"files": ["manifest.json", "skills", "README.md"]
```

All 9 member skill trees live under `skills/`.

---

## Exact commands a maintainer runs to publish (supervised gates)

> **NONE of these have been run yet.** Run in order, in a supervised session.

### Step 0 — Verify the bundle members are current

```bash
# From ikenga-pkgs root
ls packages/skills/studio-archetypes/skills/
# Expect: animation-patterns archetype-ai-short archetype-explainer archetype-montage
#         archetype-music-video archetype-narrative archetype-product archetype-tutorial
#         studio-core-blocks
```

### Step 1 — Add a changeset

```bash
# From ikenga-pkgs root
pnpm changeset      # bump "@ikenga/studio-archetypes": minor (initial 0.1.0)
```

### Step 2 — Version the package (Changesets)

```bash
pnpm changeset version
# Review package.json bump + CHANGELOG.md before proceeding.
```

### Step 3 — Publish to npm (SUPERVISED GATE)

```bash
# Ensure ~/.npmrc has the @ikenga granular publish token (expires 2026-08-20).
pnpm --filter @ikenga/studio-archetypes publish --access public
# Verify: npm view @ikenga/studio-archetypes
```

### Step 4 — Build + push the mirror repo (SUPERVISED GATE, one-time)

```bash
# From packages/skills/studio-archetypes/
node ./scripts/build-mirror.mjs
gh repo create royalti-io/studio-archetypes \
  --public \
  --description "studio-archetypes — Ikenga Studio archetype bundle (7 archetypes + core blocks + animation patterns)" \
  --homepage "https://ikenga.dev"
cd dist-mirror && git init -b main && git add . \
  && git commit -m "chore: initial mirror from @ikenga/studio-archetypes@0.1.0" \
  && git remote add origin https://github.com/royalti-io/studio-archetypes.git \
  && git push -u origin main
```

### Step 5 — Verify end-to-end install (all members)

```bash
mkdir /tmp/studio-archetypes-test && cd /tmp/studio-archetypes-test
# Install the bundle — the skills CLI runs --skill '*' for kind:bundle
npx skills add royalti-io/studio-archetypes
ls .claude/skills/      # expect all 9 member skill dirs present
```

---

## Notes

- `kind: "bundle"` in `manifest.json` signals the Ọba resolver and the skills CLI
  that this is a multi-skill package. The CLI expands `--skill '*'` at install
  time to install each `skills/<member>/` directory.
- The catalog (`primitives.json`) entry for this bundle carries `kind: "bundle"` and
  a `members[]` array derived at publish from the `skills/` directory listing.
  The catalog-generation tooling (`lift-requires.mjs` / `update-registry-index.mjs`)
  needs a members-derivation step for `kind: "bundle"` packages — that is WP-23
  (publish).
- The `@ikenga/` npm scope is owned by Royalti, Inc. The granular publish token
  is saved in `~/.npmrc`; it expires 2026-08-20. Regenerate via `claude-in-chrome`
  if expired (see memory: `npm_publish_token`).
- `royalti-io/studio-archetypes` does not exist yet. Creating it is an explicit
  supervised gate (Step 4).
- Keep `private: true` in the mirror `package.json` — the mirror repo is an
  install surface, not a second npm publish path.
- Archetype block-ID resolution stays intra-package: all 9 members are versioned
  and released as a single unit so cross-archetype block references never drift.
