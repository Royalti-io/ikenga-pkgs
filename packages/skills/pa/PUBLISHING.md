# PUBLISHING — @ikenga/skill-pa

> **Status: WP-14-prep DONE — not yet published.**
> The artifacts on this page are ready. The commands below have NOT been run.
> npm publish and mirror-repo creation are the explicit supervised follow-up
> that must be run by the maintainer in a gated session.

---

## The 3-copy sync

`skill-pa` travels through three copies before a user can `npx skills add` it.
Understanding the chain prevents edits landing in the wrong place.

```
Copy 1  ikenga/.claude/skills/pa/       ← dev source (workspace dogfood)
   ↓    node ./scripts/sync-from-dev.mjs
Copy 2  ikenga-pkgs/packages/skills/pa/ ← canonical (this repo; Changesets-versioned)
   ↓    node ./scripts/build-mirror.mjs
Copy 3  dist-mirror/                     ← staged mirror tree (local only)
   ↓    git push ikenga-hq/skill-pa
Mirror  github.com/ikenga-hq/skill-pa  ← public mirror (npx skills add target)
```

### Copy 1 — dev source

Path: `/home/nedjamez/royalti-co/ikenga/.claude/skills/pa/`

This is the live working copy, dogfooded in the ikenga workspace. It does NOT
exist yet at the time of WP-14-prep (the skill tree was authored directly in
Copy 2 during WP-11/WP-12). Before the first `sync-from-dev` run, the
maintainer must either:

- Seed Copy 1 by copying `packages/skills/pa/skills/pa/` into
  `ikenga/.claude/skills/pa/`; **or**
- Accept that `sync-from-dev` is a no-op on the first cycle and treat Copy 2
  as the source of truth until the next edit cycle.

For the initial publish, Copy 2 is already the authoritative source.
`sync-from-dev` becomes relevant on subsequent edit→publish cycles.

### Copy 2 — canonical (this repo)

Path: `packages/skills/pa/` (this directory; `ikenga-pkgs` monorepo)

This is the Changesets-versioned, npm-published copy. The `files` field in
`package.json` controls what ships to the npm registry:

```json
"files": ["manifest.json", "skills", "README.md"]
```

The skill tree lives under `skills/pa/` inside this package. Changesets manages
versioning (`pnpm changeset`); the release workflow in
`.github/workflows/release.yml` calls `pnpm publish` after the "Version
Packages" PR is merged.

### Copy 3 — mirror tree (`dist-mirror/`)

Path: `packages/skills/pa/dist-mirror/` (local only, gitignored)

`build-mirror.mjs` (to be written — see §Scripts below) assembles a
self-contained mirror tree that matches the `ikenga-hq/groundwork` layout:

```
dist-mirror/
├── package.json   (standalone — private:true, no workspace fields)
├── README.md      (install instructions + portability pointer)
├── install.sh     (curl-install script; SKILL_NAME=pa)
├── LICENSE        (Apache-2.0)
├── .gitignore
└── skills/pa/     (copied from this package's skills/pa/)
```

The mirror tree is **not committed** to `ikenga-pkgs`. It is a build output
pushed (by hand, gated) to `github.com/ikenga-hq/skill-pa`.

---

## Scripts

Two scripts parallel the `skill-groundwork` model. **Neither script exists yet
at WP-14-prep time** — they are the first thing to write in the WP-14 exec
session.

### `sync-from-dev.mjs` (to author)

Mirrors `ikenga/.claude/skills/pa/` → `skills/pa/` inside this package.
Prepends `GENERATED` banners to `.md`/`.html` files. Idempotent (strips old
banners before re-adding). Propagates deletions from the source.

Reference: `packages/skills/groundwork/scripts/sync-from-dev.mjs` — adapt
by changing `SKILL_NAME = 'pa'`, `SKILL_SLUG = 'pa'`, and the default `--src`
path to `ikenga/.claude/skills/pa/`.

### `build-mirror.mjs` (to author)

Assembles `dist-mirror/` from the synced `skills/pa/` tree plus generated
`package.json`, `README.md`, `install.sh`, `LICENSE`, `.gitignore`.

Reference: `packages/skills/groundwork/scripts/build-mirror.mjs` — adapt by
changing `SKILL_NAME = 'pa'`, `MIRROR_REPO = 'ikenga-hq/skill-pa'`.

---

## Exact commands a maintainer runs to publish

> **NONE of these have been run yet.** Run them in order, in a supervised
> session. Each step is a checkpoint — stop and review before proceeding.

### Step 0 — Verify the skill tree is current

```bash
# From ikenga-pkgs root
ls packages/skills/pa/skills/pa/actions/
# Expect: briefing.md  README.md  send.md  setup.md  triage.md
```

### Step 1 — Author the scripts (first-time only)

Write `scripts/sync-from-dev.mjs` and `scripts/build-mirror.mjs` modelled on
the `skill-groundwork` equivalents (see §Scripts above). Add them to
`package.json`:

```json
"scripts": {
  "sync:from-dev": "node ./scripts/sync-from-dev.mjs",
  "build:mirror": "node ./scripts/build-mirror.mjs"
}
```

### Step 2 — Sync from dev source (skip on first publish if dev source is absent)

```bash
# From packages/skills/pa/
node ./scripts/sync-from-dev.mjs
# Review the diff — confirm banners added, no unexpected deletions.
```

### Step 3 — Confirm the changeset is present

```bash
# From ikenga-pkgs root
cat .changeset/skill-pa-initial.md
# Expect: bump "@ikenga/skill-pa": minor  +  description block
```

### Step 4 — Version the package (Changesets)

```bash
# From ikenga-pkgs root
pnpm changeset version
# This consumes .changeset/skill-pa-initial.md, bumps package.json to 0.1.0,
# and writes CHANGELOG.md.  Review both files before proceeding.
```

### Step 5 — Publish to npm

```bash
# Ensure ~/.npmrc has the @ikenga granular publish token (expires 2026-08-20).
# From ikenga-pkgs root:
pnpm --filter @ikenga/skill-pa publish --access public
# Verify: npm view @ikenga/skill-pa
```

> This is the supervised gate. Do NOT run this until the session owner has
> reviewed and approved the changeset + versioned package.json.

### Step 6 — Build the mirror tree

```bash
# From packages/skills/pa/
node ./scripts/build-mirror.mjs
# Inspect dist-mirror/ — spot-check package.json, install.sh, skills/pa/SKILL.md
```

### Step 7 — Create the mirror repo (supervised, one-time)

```bash
# Requires gh CLI authenticated as ikenga-hq org member.
gh repo create ikenga-hq/skill-pa \
  --public \
  --description "PA dispatch skill for Ikenga — briefing, triage, send-queue" \
  --homepage "https://ikenga.dev"

# Push the mirror tree as the initial commit:
cd packages/skills/pa/dist-mirror
git init -b main
git add .
git commit -m "chore: initial mirror from @ikenga/skill-pa@0.1.0"
git remote add origin https://github.com/ikenga-hq/skill-pa.git
git push -u origin main
```

> This is the second supervised gate. Do NOT run until Step 5 (npm publish)
> has been confirmed green and the mirror tree has been reviewed.

### Step 8 — Verify end-to-end install

```bash
# In a clean temp dir, confirm the npx skills add surface works:
mkdir /tmp/skill-pa-test && cd /tmp/skill-pa-test
npx skills add ikenga-hq/skill-pa
ls .claude/skills/pa/
# Expect SKILL.md + actions/ + lib/ + agents/
```

### Step 9 — Update registry index (automated)

The `scripts/update-registry-index.mjs` in `ikenga-pkgs` pushes a fresh entry
to `ikenga-registry` as part of the Changesets release workflow. If you ran
Steps 4–5 via the Changesets release PR (recommended), this fires automatically.
If you published manually (Step 5), run:

```bash
node scripts/update-registry-index.mjs
```

---

## Subsequent edit cycles

After the initial publish, the edit → publish cycle is:

1. Edit `ikenga/.claude/skills/pa/` (the dev source, Copy 1).
2. `pnpm sync:from-dev` (from `packages/skills/pa/`) to propagate to Copy 2.
3. `pnpm changeset` (from `ikenga-pkgs/`) to record the bump.
4. PR → merge → Changesets "Version Packages" PR → merge → auto-publish.
5. `pnpm build:mirror` → review `dist-mirror/` → push to `ikenga-hq/skill-pa`.

---

## Notes

- The `@ikenga/` npm scope is owned by Royalti, Inc. The granular publish
  token is saved in `~/.npmrc`; it expires 2026-08-20. Regenerate via
  `claude-in-chrome` if expired (see memory: `npm_publish_token`).
- `ikenga-hq/skill-pa` does not exist yet. Creating it is an explicit
  supervised gate (Step 7 above).
- The `dist-mirror/` directory should be added to `.gitignore` (ikenga-pkgs
  root or this package's local `.gitignore`) so it is never accidentally
  committed.
- Keep `private: true` in the mirror `package.json` — the mirror repo is an
  install surface, not a second npm publish path.
