# PUBLISHING — @ikenga/skill-core

> **Status: WP-15 build DONE, offline-verified — not yet published.**
> The package on this page is scaffolded, validated, and round-trip-proven
> offline. The commands below have NOT been run. npm publish and mirror-repo
> creation are the explicit supervised follow-up that must be run by the
> maintainer in a gated session (same gate as `@ikenga/skill-pa`).

---

## The 3-copy sync

`skill-core` travels through three copies before a user can `npx skills add` it,
exactly like `skill-pa` and `skill-groundwork`.

```
Copy 1  ikenga/.claude/skills/skill-core/  ← dev source (workspace dogfood)
   ↓    node ./scripts/sync-from-dev.mjs
Copy 2  ikenga-pkgs/packages/skills/core/   ← canonical (this repo; Changesets-versioned)
   ↓    node ./scripts/build-mirror.mjs
Copy 3  dist-mirror/                          ← staged mirror tree (local only)
   ↓    git push royalti-io/skill-core
Mirror  github.com/royalti-io/skill-core     ← public mirror (npx skills add target)
```

For the initial publish, Copy 2 (this directory) is the authoritative source;
`sync-from-dev` becomes relevant on subsequent edit→publish cycles. Author
`scripts/sync-from-dev.mjs` + `scripts/build-mirror.mjs` modelled on the
`skill-pa` / `skill-groundwork` equivalents (change `SKILL_NAME = 'skill-core'`,
`SKILL_SLUG = 'core'`, `MIRROR_REPO = 'royalti-io/skill-core'`, and the
`--src` path to `ikenga/.claude/skills/skill-core/`).

The package's `files` field controls what ships to npm:

```json
"files": ["manifest.json", "skills", "README.md"]
```

The skill tree lives under `skills/core/`.

---

## Exact commands a maintainer runs to publish (supervised gates)

> **NONE of these have been run yet.** Run in order, in a supervised session.

### Step 0 — Verify the skill tree is current

```bash
# From ikenga-pkgs root
ls packages/skills/core/skills/core/actions/
# Expect: setup.md
```

### Step 1 — Add a changeset

```bash
# From ikenga-pkgs root
pnpm changeset      # bump "@ikenga/skill-core": minor (initial 0.1.0)
```

### Step 2 — Version the package (Changesets)

```bash
pnpm changeset version
# Review package.json bump + CHANGELOG.md before proceeding.
```

### Step 3 — Publish to npm (SUPERVISED GATE)

```bash
# Ensure ~/.npmrc has the @ikenga granular publish token (expires 2026-08-20).
pnpm --filter @ikenga/skill-core publish --access public
# Verify: npm view @ikenga/skill-core
```

### Step 4 — Build + push the mirror repo (SUPERVISED GATE, one-time)

```bash
# From packages/skills/core/
node ./scripts/build-mirror.mjs
gh repo create royalti-io/skill-core \
  --public \
  --description "skill-core — the Ikenga skill-graph identity hub (setup)" \
  --homepage "https://ikenga.dev"
cd dist-mirror && git init -b main && git add . \
  && git commit -m "chore: initial mirror from @ikenga/skill-core@0.1.0" \
  && git remote add origin https://github.com/royalti-io/skill-core.git \
  && git push -u origin main
```

### Step 5 — Verify end-to-end install

```bash
mkdir /tmp/skill-core-test && cd /tmp/skill-core-test
npx skills add royalti-io/skill-core
ls .claude/skills/core/      # expect SKILL.md + actions/setup.md
```

---

## Notes

- The `@ikenga/` npm scope is owned by Royalti, Inc. The granular publish token
  is saved in `~/.npmrc`; it expires 2026-08-20. Regenerate via `claude-in-chrome`
  if expired (see memory: `npm_publish_token`).
- `royalti-io/skill-core` does not exist yet. Creating it is an explicit
  supervised gate (Step 4).
- Keep `private: true` in the mirror `package.json` — the mirror repo is an
  install surface, not a second npm publish path.
- **Why this matters:** once `skill-core` is in the Ọba catalog, installing any
  P4 domain pkg auto-pulls it through the forward-dependency resolver (Ọba
  Phase 4, WP-11..16). skill-core is the resolver's first real test dependency.
