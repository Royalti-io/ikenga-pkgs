#!/usr/bin/env node
/**
 * build-mirror.mjs — emit the standalone `royalti-io/groundwork` mirror tree.
 *
 * The mirror repo is the `npx skills add royalti-io/groundwork` install
 * surface. It mirrors the proven `ikenga-artifact-builder` layout:
 *
 *   <out>/
 *   ├── package.json   (mirror — slimmed from this package's)
 *   ├── README.md      (install + portability pointer)
 *   ├── install.sh     (clone + symlink; SKILL_NAME=groundwork)
 *   ├── LICENSE         (Apache-2.0)
 *   ├── .gitignore
 *   └── skills/groundwork/   (copied from this package's synced tree)
 *
 * This script does NOT push anywhere. It only produces the tree locally so a
 * (gated) follow-up can review + push it to royalti-io/groundwork.
 *
 * Run `sync:from-dev` first so ./skills/groundwork/ is current.
 *
 * Usage:
 *   node ./scripts/build-mirror.mjs [--out <dir>]   (default: ./dist-mirror)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const SKILL_NAME = 'groundwork';
const MIRROR_REPO = 'royalti-io/groundwork';

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx !== -1 ? resolve(process.argv[outIdx + 1]) : join(PKG_ROOT, 'dist-mirror');

const SYNCED = join(PKG_ROOT, 'skills', SKILL_NAME);

function main() {
  if (!existsSync(join(SYNCED, 'SKILL.md'))) {
    console.error(`[mirror] synced skill tree not found at ${SYNCED}`);
    console.error(`[mirror] run \`pnpm sync:from-dev\` first.`);
    process.exit(1);
  }

  // Clean rebuild of the output dir.
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  // 1. skills/<name>/ — copied from the synced tree.
  cpSync(SYNCED, join(OUT, 'skills', SKILL_NAME), { recursive: true });

  // 2. LICENSE — copied verbatim.
  cpSync(join(PKG_ROOT, 'LICENSE'), join(OUT, 'LICENSE'));

  // 3. package.json — slimmed mirror (standalone repo, not a workspace member).
  const src = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
  const mirrorPkg = {
    name: src.name,
    version: src.version,
    description: src.description,
    keywords: src.keywords,
    homepage: src.homepage,
    bugs: { url: `https://github.com/${MIRROR_REPO}/issues` },
    repository: { type: 'git', url: `git+https://github.com/${MIRROR_REPO}.git` },
    license: src.license,
    private: true,
    engines: src.engines,
    files: ['skills/'],
  };
  writeFileSync(join(OUT, 'package.json'), JSON.stringify(mirrorPkg, null, 2) + '\n');

  // 4. install.sh — adapted from ikenga-artifact-builder, SKILL_NAME=groundwork.
  writeFileSync(join(OUT, 'install.sh'), INSTALL_SH, { mode: 0o755 });

  // 5. README.md — install + portability pointer.
  writeFileSync(join(OUT, 'README.md'), README_MD);

  // 5a. assets/ — screenshots + quickstart demo (README references these at assets/*).
  const assetsDir = join(PKG_ROOT, 'assets');
  if (existsSync(assetsDir)) {
    cpSync(assetsDir, join(OUT, 'assets'), { recursive: true });
  }

  // 6. .gitignore.
  writeFileSync(join(OUT, '.gitignore'), '.DS_Store\n*.log\nnode_modules/\n');

  const fileCount = listFiles(OUT).length;
  console.log(`[mirror] emitted ${fileCount} files → ${OUT}`);
  console.log(`[mirror] next: review, then push to ${MIRROR_REPO} (gated on user approval).`);
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(full);
  }
  return out;
}

const INSTALL_SH = `#!/usr/bin/env bash
#
# groundwork — install script
#
# Installs the skill into ~/.claude/skills/groundwork as a symlink against a
# cached clone in ~/.cache/ikenga-skills/. Update path is
# \`git -C ~/.cache/ikenga-skills/groundwork pull\`.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/royalti-io/groundwork/main/install.sh | bash
#
# Env overrides:
#   SKILLS_DIR    target skills dir (default: $HOME/.claude/skills)
#   CACHE_DIR     clone cache dir   (default: $HOME/.cache/ikenga-skills)
#   REPO_URL      repo to clone     (default: https://github.com/royalti-io/groundwork.git)
#   REF           git ref to check out (default: main)

set -euo pipefail

SKILL_NAME="groundwork"
SKILLS_DIR="\${SKILLS_DIR:-$HOME/.claude/skills}"
CACHE_DIR="\${CACHE_DIR:-$HOME/.cache/ikenga-skills}"
REPO_URL="\${REPO_URL:-https://github.com/royalti-io/groundwork.git}"
REF="\${REF:-main}"

CLONE_DIR="$CACHE_DIR/$SKILL_NAME"
TARGET="$SKILLS_DIR/$SKILL_NAME"
SOURCE="$CLONE_DIR/skills/$SKILL_NAME"

log()  { printf '\\033[36m[ikenga]\\033[0m %s\\n' "$*"; }
warn() { printf '\\033[33m[ikenga]\\033[0m %s\\n' "$*" >&2; }
die()  { printf '\\033[31m[ikenga]\\033[0m %s\\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required but not installed."

mkdir -p "$SKILLS_DIR" "$CACHE_DIR"

if [ -d "$CLONE_DIR/.git" ]; then
  log "Updating cached clone at $CLONE_DIR"
  git -C "$CLONE_DIR" fetch --quiet origin "$REF"
  git -C "$CLONE_DIR" checkout --quiet "$REF"
  git -C "$CLONE_DIR" reset --quiet --hard "origin/$REF"
else
  log "Cloning $REPO_URL into $CLONE_DIR"
  git clone --quiet --branch "$REF" --depth 1 "$REPO_URL" "$CLONE_DIR"
fi

[ -d "$SOURCE" ] || die "Skill source not found at $SOURCE (repo layout changed?)."

if [ -L "$TARGET" ]; then
  log "Replacing existing symlink at $TARGET"
  rm "$TARGET"
elif [ -e "$TARGET" ]; then
  BACKUP="$TARGET.bak.\$(date +%s)"
  warn "Existing non-symlink at $TARGET — backing up to $BACKUP"
  mv "$TARGET" "$BACKUP"
fi

ln -s "$SOURCE" "$TARGET"

log "Installed: $TARGET -> $SOURCE"
log "Update later: git -C $CLONE_DIR pull"
`;

const README_MD = `# groundwork

**A Claude Code skill that scaffolds and maintains a living plan folder. Re-runs augment your work — they never overwrite it.**

\`\`\`bash
npx skills add royalti-io/groundwork
\`\`\`

Works with Claude Code, Codex, Gemini, Cursor, and 70+ other agents.

---

## Quickstart demo

<!-- Interactive demo — open in a browser: assets/quickstart-demo.html -->

**[▶ Open interactive quickstart demo](assets/quickstart-demo.html)**
*(init → research → review → orchestrate — 4 steps, keyboard-navigable)*

---

## What it does

You give groundwork a goal. It scaffolds a folder of numbered, living documents — a plan, two research files, a discussion log, a tracking file, and a standalone HTML board you can open in any browser. Then it gives you a small set of actions you can run at any time: \`research\`, \`design\`, \`review\`, \`orchestrate\`, \`refresh-board\`.

The part that matters: every block the skill generates is wrapped in a fenced region. **Everything outside a fence is yours and is never touched.** When you re-run an action, a checksum decides what changes on disk — not the model. A vibe you can't trust; a sha256 you can.

---

## Plan board

The board reads your tracking file and renders three views: mission control, Kanban, and a dependency-graph of your wave plan.

![groundwork board — Kanban view with status columns and a work-package brief panel](assets/ss-board-kanban.png)

![groundwork board — DAG view showing wave order and gate dependencies](assets/ss-board-dag.png)

It is a [self-contained HTML artifact](https://ikenga.dev): open it in any browser, no server needed. Inside the Ikenga workspace it renders live next to your running sessions.

---

## The folder shape

\`\`\`
plans/your-feature/
├── .groundwork.json          ← identity + state anchor
├── 00-README.md              ← north star + links
├── 01-plan.md                ← goal, phases, architecture, risks
├── 02-research-external.md   ← prior art, competitors, libraries
├── 03-research-internal.md   ← codebase, schema, constraints
├── 04-discussion.md          ← review rounds, newest-first
├── 05-tracking.md            ← WPs, deps, DoDs, status
├── 09-orchestration.md       ← wave plan + per-WP kickoff briefs
└── artifact/
    └── board.html            ← standalone plan board
\`\`\`

![Folder treemap — the spine visualised as a proportional area map](assets/keyart-folder-treemap.png)

---

## Profiles

A profile swaps vocabulary and optional blocks — not the spine. The safe-regeneration machinery is identical across all four.

| Profile | For | Work unit |
|---|---|---|
| \`software\` | Features, code work | work package / PR |
| \`general\` | Campaigns, org changes, non-code | workstream / deliverable |
| \`content\` | Editorial work, content series | piece / asset |
| \`design-system\` | Component/token systems | part |

The \`design-system\` profile adds a parts gallery, token pipeline, and a per-part quality gate.

![design-system profile — living component gallery with foundations and parts tracked against tokens](assets/ss-designsystem-gallery.png)

---

## Action set

| Action | What it does |
|---|---|
| \`init\` | Interview + scaffold the folder skeleton |
| \`research\` | Fill \`02\`/\`03\` research files (external + internal) |
| \`design\` | Produce ≥2 comparable design options, lock one |
| \`subplan\` | Scaffold a focused sub-plan (diff-plan / decision-doc / bug-doc) |
| \`review\` | Gap analysis → new Round in \`04\` → re-sync tracking |
| \`clarify\` | Readiness gate before \`orchestrate\` |
| \`orchestrate\` | Emit \`09-orchestration.md\` with wave plan + WP briefs |
| \`refresh-board\` | Regenerate \`artifact/board.html\` from current docs |
| \`status\` | Read-only freshness + ID + coverage report |

Add \`--emit-workflow\` to \`orchestrate\` for a runnable Claude Code Workflow that fans waves out in parallel and turns freeze gates into sign-off barriers.

---

## Install

### \`npx skills\` (recommended)

\`\`\`bash
# Global — available across all projects
npx skills add royalti-io/groundwork -g

# Project — committed with your repo, shared with the team
npx skills add royalti-io/groundwork
\`\`\`

### Git clone

\`\`\`bash
git clone https://github.com/royalti-io/groundwork.git
cp -r groundwork/skills/groundwork ~/.claude/skills/
\`\`\`

### Curl one-liner

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/royalti-io/groundwork/main/install.sh | bash
\`\`\`

The installer drops the skill into \`~/.claude/skills/groundwork/\` via symlink
against a cached clone in \`~/.cache/ikenga-skills/\`, so \`git pull\` is the
update path.

---

## Usage

After install, in any Claude Code session:

\`\`\`
/groundwork init plans/<your-plan>/ --profile software --goal "…"
\`\`\`

Then run actions as the work progresses:

\`\`\`
/groundwork research plans/<your-plan>/
/groundwork review plans/<your-plan>/
/groundwork orchestrate plans/<your-plan>/
\`\`\`

See [\`skills/groundwork/SKILL.md\`](skills/groundwork/SKILL.md) for the full agent-facing spec.

---

## Further reading

- **Blog post:** [I built a planning skill because my plans kept rotting](https://royalti.io/blog/groundwork-planning-that-doesnt-rot)
- **Docs:** [ikenga.dev/packages/groundwork](https://ikenga.dev/packages/groundwork)
- **Ikenga workspace:** [ikenga.dev](https://ikenga.dev)

---

## License

[Apache-2.0](LICENSE). Copyright © 2026 Royalti.io.
`;

main();
