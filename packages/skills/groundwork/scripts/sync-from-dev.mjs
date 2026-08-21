#!/usr/bin/env node
/**
 * sync-from-dev.mjs — one-way sync of the groundwork skill tree.
 *
 *   dev source  →  this package
 *   .claude/skills/groundwork/   →   ./skills/groundwork/
 *
 * The dev source is the working copy this workspace edits + dogfoods.
 * The copy under this package is GENERATED and Changesets-versioned (ADR-009).
 * Never hand-edit ./skills/groundwork/ — edit the dev source and re-run this.
 *
 * Behaviour:
 *   - Recursively copies every file from the source tree.
 *   - Prepends a GENERATED banner to .md / .html files (comment syntax per type).
 *     JSON files are copied verbatim (JSON has no comment syntax).
 *   - Idempotent: strips any pre-existing banner before re-adding, so re-runs
 *     do not stack banners and produce a byte-identical tree.
 *   - Mirrors the source: files removed from the source are removed here too
 *     (except PORTABILITY.md, which this script generates — see below).
 *
 * Usage:
 *   node ./scripts/sync-from-dev.mjs [--src <path-to-dev-source>]
 *
 * Default --src resolves to the workspace dev path relative to this script.
 * Script lives at  ikenga-pkgs/packages/skills/groundwork/scripts/, and the
 * dev source at     <workspace>/.claude/skills/groundwork/ — five levels up:
 *   scripts → groundwork → skills → packages → ikenga-pkgs → <workspace>
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const DEST = join(PKG_ROOT, 'skills', 'groundwork');

// --src override, else the workspace dev path relative to this script.
const argSrcIdx = process.argv.indexOf('--src');
const DEFAULT_SRC = resolve(__dirname, '..', '..', '..', '..', '..', '.claude', 'skills', 'groundwork');
const SRC = argSrcIdx !== -1 ? resolve(process.argv[argSrcIdx + 1]) : DEFAULT_SRC;

const BANNER_TEXT = 'GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs.';
// Banners we recognise + strip before re-adding (keeps re-runs idempotent).
const HTML_BANNER = `<!-- ${BANNER_TEXT} -->`;
// Match a leading HTML banner (any whitespace/newlines after it) for stripping.
const HTML_BANNER_RE = /^<!--\s*GENERATED — edit \.claude\/skills\/groundwork\/ instead\. Synced by sync-from-dev\.mjs\.\s*-->\n?/;

const BANNER_EXTS = new Set(['.md', '.html', '.htm']);

/** Recursively list files (relative paths) under a dir. */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

// A banner sitting right after a YAML frontmatter block (the SKILL.md case).
const FM_BANNER_RE = /^(---\n[\s\S]*?\n---\n)<!--\s*GENERATED — edit \.claude\/skills\/groundwork\/ instead\. Synced by sync-from-dev\.mjs\.\s*-->\n?/;

/** Strip a previously-injected banner from content (idempotency).
 *  The banner may sit at the very top OR — for files with leading YAML
 *  frontmatter — immediately after the closing `---`. Strip both forms. */
function stripBanner(content) {
  return content.replace(HTML_BANNER_RE, '').replace(FM_BANNER_RE, '$1');
}

/** Add the GENERATED banner to .md/.html content (after stripping any old one).
 *  Files that lead with a YAML frontmatter block (`---` on line 1, e.g.
 *  SKILL.md) MUST keep that frontmatter on line 1 — the `skills add` CLI only
 *  detects `name`/`description` when the frontmatter is the very first thing in
 *  the file. So for those, the banner is inserted AFTER the closing `---`. */
function withBanner(content) {
  const body = stripBanner(content);
  const fm = body.match(/^(---\n[\s\S]*?\n---\n)/);
  if (fm) return `${fm[1]}${HTML_BANNER}\n${body.slice(fm[1].length)}`;
  return `${HTML_BANNER}\n${body}`;
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync] dev source not found: ${SRC}`);
    console.error(`[sync] pass --src <path> or run from the workspace.`);
    process.exit(1);
  }

  const srcFiles = listFiles(SRC);

  // Wipe the destination skill tree so removals in the source propagate.
  // Idempotent: a clean rebuild each run.
  if (existsSync(DEST)) {
    for (const rel of listFiles(DEST)) {
      rmSync(join(DEST, rel));
    }
  }

  let copied = 0;
  let bannered = 0;
  for (const rel of srcFiles) {
    const srcPath = join(SRC, rel);
    const destPath = join(DEST, rel);
    mkdirSync(dirname(destPath), { recursive: true });

    const ext = extname(rel).toLowerCase();
    if (BANNER_EXTS.has(ext)) {
      const content = readFileSync(srcPath, 'utf8');
      writeFileSync(destPath, withBanner(content));
      bannered++;
    } else {
      // JSON, .gitkeep, binaries: copy verbatim (no comment syntax to inject).
      const buf = readFileSync(srcPath);
      writeFileSync(destPath, buf);
    }
    copied++;
  }

  // PORTABILITY.md is generated by this package (the "document-don't-fix"
  // deliverable), not synced from the dev source. Folding it into the sync
  // script (option b in WP-18) means it's regenerated on every run, so it
  // survives the wipe-and-rebuild above instead of being clobbered.
  writePortabilityNote();

  console.log(`[sync] source: ${SRC}`);
  console.log(`[sync] dest:   ${DEST}`);
  console.log(`[sync] copied ${copied} files (${bannered} with GENERATED banner) + PORTABILITY.md`);
}

/** Generate PORTABILITY.md inside the synced skill dir. */
function writePortabilityNote() {
  writeFileSync(join(DEST, 'PORTABILITY.md'), PORTABILITY_MD);
}

const PORTABILITY_MD = `<!-- GENERATED — edit scripts/sync-from-dev.mjs (writePortabilityNote) instead. -->
# Portability notes

\`groundwork\` is built to scaffold a plan folder into **any** Claude Code
project. A few references in this skill's shipped files point at paths that
only exist in the workspace where the skill was authored
(\`ikenga-hq/ikenga\`). They are **illustrative**, not requirements — a target
project will not have them, and nothing breaks if they're absent. Per the
locked WP-18 decision this is **document-don't-fix**: the references are
disclosed here rather than rewritten. A future "full-portability" WP can
replace them if adoption warrants.

## 1. \`plans/studio\` / \`plans/groundwork\` references in the docs

These are this-workspace examples baked into the skill's prose. Treat any
mention of \`plans/studio\` or \`plans/groundwork\` as a sample plan folder —
substitute your own (e.g. \`plans/<your-plan>/\`). They never need to exist for
the skill to run.

Files carrying these references:

- \`SKILL.md\` — both \`plans/studio\` and \`plans/groundwork\`
- \`actions/init.md\` — \`plans/studio\`
- \`actions/orchestrate.md\` — \`plans/studio\`
- \`actions/review.md\` — \`plans/studio\`
- \`actions/subplan.md\` — \`plans/studio\`
- \`actions/design.md\` — \`plans/groundwork\`
- \`actions/refresh-board.md\` — \`plans/groundwork\`
- \`lib/state.md\` — \`plans/groundwork\`
- \`profiles/_shared/templates/drafts/README.md\` — \`plans/studio\`
- \`profiles/_shared/board/index.html\` — both (see runtime fallback below)

## 2. Runtime fallback in the standalone board (\`profiles/_shared/board/index.html\`)

The board template ships with a hardcoded \`'plans/groundwork'\` **fallback**
used before \`groundwork refresh-board\` has run against a real plan folder.
Three spots rely on it:

- **\`board-meta\` fence default** — the \`plan_folder\` field is seeded with the
  \`{{plan_folder}}\` mustache placeholder; until \`init\` / \`refresh-board\`
  substitutes it, the board has no real plan path.
- **\`substituteAction()\` fallback** — when building an action card's
  copy-prompt, \`{plan_folder}\` falls back to \`'plans/groundwork'\` if the meta
  fence hasn't been refreshed yet.
- **\`board-mock-data\` block** — the pre-refresh preview data describes the
  authoring workspace's own Studio plan.

**Effect in a target project:** the board still renders standalone and the
copy-prompt floor still works. Until you run \`groundwork refresh-board\`
against your plan folder, the *cited* path in a copied prompt may read
\`plans/groundwork\` — illustrative, not a real path in your project. After the
first \`refresh-board\`, the real \`plan_folder\` is substituted everywhere and the
fallback is no longer used.

This is recorded as a **known limitation**, deferred to a future portability WP.
`;

main();
