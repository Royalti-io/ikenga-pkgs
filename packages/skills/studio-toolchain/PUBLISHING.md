# PUBLISHING — @ikenga/studio-toolchain

> **Status: WP-22 naming reconciliation DONE — not yet published.**
> The package on this page is scaffolded, validated, and naming-reconciled.
> The commands below have NOT been run. npm publish and mirror-repo creation
> are the explicit supervised follow-up that must be run by the maintainer in
> a gated session (same gate as `@ikenga/skill-pa`).

---

## Bundle overview

`studio-toolchain` is a **bundle** (`kind: "bundle"` in manifest.json). A bundle
is a single publish unit that installs multiple member skills in one operation.
The skills CLI resolves `kind: "bundle"` by running `skills add --skill '*'` which
installs all members from the bundle's `skills/` directory.

Members shipped in this bundle (7 skills):

| Member slug | Skills dir |
|---|---|
| `freeform-video` | `skills/freeform-video/` |
| `generate-narration` | `skills/generate-narration/` |
| `studio-archetype-build` | `skills/studio-archetype-build/` |
| `studio-block-author` | `skills/studio-block-author/` |
| `studio-init` | `skills/studio-init/` |
| `studio-oneshot` | `skills/studio-oneshot/` |
| `studio-watch` | `skills/studio-watch/` |

Together these 7 skills form the interview / instantiate / render / author loop
that drives the Studio MCP surface (`archetype.*` / `block.*` / `render.*`).

The catalog entry (`primitives.json`) for this bundle will carry
`kind: "bundle"` and a `members[]` array derived at publish (WP-23).

---

## The 3-copy sync

`studio-toolchain` travels through three copies before a user can install it
via the Ikenga skills CLI, exactly like `skill-pa` and `skill-groundwork`.

```
Copy 1  ikenga/.claude/skills/studio-toolchain/  ← dev source (workspace dogfood)
   ↓    node ./scripts/sync-from-dev.mjs
Copy 2  ikenga-pkgs/packages/skills/studio-toolchain/  ← canonical (this repo; Changesets-versioned)
   ↓    node ./scripts/build-mirror.mjs
Copy 3  dist-mirror/                                     ← staged mirror tree (local only)
   ↓    git push royalti-io/studio-toolchain
Mirror  github.com/royalti-io/studio-toolchain           ← public mirror (install target)
```

For the initial publish, Copy 2 (this directory) is the authoritative source;
`sync-from-dev` becomes relevant on subsequent edit→publish cycles. Author
`scripts/sync-from-dev.mjs` + `scripts/build-mirror.mjs` modelled on the
`skill-pa` / `skill-groundwork` equivalents (change `SKILL_NAME = 'studio-toolchain'`,
`SKILL_SLUG = 'studio-toolchain'`, `MIRROR_REPO = 'royalti-io/studio-toolchain'`,
and the `--src` path to `ikenga/.claude/skills/studio-toolchain/`).

The package's `files` field controls what ships to npm:

```json
"files": ["manifest.json", "skills", "README.md"]
```

All 7 member skill trees live under `skills/`.

---

## Exact commands a maintainer runs to publish (supervised gates)

> **NONE of these have been run yet.** Run in order, in a supervised session.

### Step 0 — Verify the bundle members are current

```bash
# From ikenga-pkgs root
ls packages/skills/studio-toolchain/skills/
# Expect: freeform-video generate-narration studio-archetype-build studio-block-author
#         studio-init studio-oneshot studio-watch
```

### Step 1 — Add a changeset

```bash
# From ikenga-pkgs root
pnpm changeset      # bump "@ikenga/studio-toolchain": minor (initial 0.1.0)
```

### Step 2 — Version the package (Changesets)

```bash
pnpm changeset version
# Review package.json bump + CHANGELOG.md before proceeding.
```

### Step 3 — Publish to npm (SUPERVISED GATE)

```bash
# Ensure ~/.npmrc has the @ikenga granular publish token (expires 2026-08-20).
pnpm --filter @ikenga/studio-toolchain publish --access public
# Verify: npm view @ikenga/studio-toolchain
```

### Step 4 — Build + push the mirror repo (SUPERVISED GATE, one-time)

```bash
# From packages/skills/studio-toolchain/
node ./scripts/build-mirror.mjs
gh repo create royalti-io/studio-toolchain \
  --public \
  --description "studio-toolchain — Ikenga Studio toolchain bundle (init/oneshot/watch/archetype-build/block-author/narration/freeform)" \
  --homepage "https://ikenga.dev"
cd dist-mirror && git init -b main && git add . \
  && git commit -m "chore: initial mirror from @ikenga/studio-toolchain@0.1.0" \
  && git remote add origin https://github.com/royalti-io/studio-toolchain.git \
  && git push -u origin main
```

### Step 5 — Verify end-to-end install (all members)

```bash
mkdir /tmp/studio-toolchain-test && cd /tmp/studio-toolchain-test
# Install the bundle — the skills CLI runs --skill '*' for kind:bundle
npx skills add royalti-io/studio-toolchain
ls .claude/skills/      # expect all 7 member skill dirs present
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
- `royalti-io/studio-toolchain` does not exist yet. Creating it is an explicit
  supervised gate (Step 4).
- Keep `private: true` in the mirror `package.json` — the mirror repo is an
  install surface, not a second npm publish path.
- `studio-toolchain` and `studio-archetypes` are versioned independently but
  always installed together by the Studio app (both listed in its `requires`).
  Bumping one does not force-bump the other unless the action contract changes.
