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

A Claude Code skill that scaffolds and maintains a reusable
**research → design → plan → orchestrate → act** folder for any non-trivial
work — software features, marketing campaigns, org changes.

It drops a domain-agnostic spine (\`00-README\` · \`01-plan\` · \`02/03\` research ·
\`04-discussion\` newest-first · \`05-tracking\` · \`09-orchestration\` · a
standalone \`artifact/board.html\` plan-board) plus stateless action-skills that
augment the docs in place without clobbering hand-written prose. Profile-driven:
\`software\` (rich default) and \`general\` (lean, non-code).

> **This repo is a generated mirror.** The canonical source lives in
> \`royalti-io/ikenga-pkgs\` at \`packages/skills/groundwork/\` (ADR-009). Do not
> edit files here — they are overwritten by the mirror build.

## Install

### \`npx skills\` (recommended)

The [\`skills\`](https://skills.sh) CLI works with Claude Code, Codex, Cursor,
OpenCode, and 50+ other agents.

\`\`\`bash
# Global install (recommended — available across all projects)
npx skills add royalti-io/groundwork -g

# Project install (committed with your repo, shared with team)
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

## Usage

After install, in any Claude Code session:

\`\`\`
/groundwork init plans/<your-plan>/ --profile software --goal "…"
\`\`\`

then \`research\` / \`design\` / \`review\` / \`orchestrate\` / \`refresh-board\` as the
work progresses. See [\`skills/groundwork/SKILL.md\`](skills/groundwork/SKILL.md)
for the full agent-facing spec.

## Portability

A few references in the docs and the standalone board point at this-workspace
example paths (\`plans/studio\` / \`plans/groundwork\`). They are illustrative; see
[\`skills/groundwork/PORTABILITY.md\`](skills/groundwork/PORTABILITY.md).

## License

[Apache-2.0](LICENSE). Copyright © 2026 Royalti.io.
`;

main();
