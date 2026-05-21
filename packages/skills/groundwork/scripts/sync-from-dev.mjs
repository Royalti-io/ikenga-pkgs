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

/** Strip a previously-injected banner from content (idempotency). */
function stripBanner(content) {
  return content.replace(HTML_BANNER_RE, '');
}

/** Add the GENERATED banner to .md/.html content (after stripping any old one). */
function withBanner(content) {
  const body = stripBanner(content);
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

  console.log(`[sync] source: ${SRC}`);
  console.log(`[sync] dest:   ${DEST}`);
  console.log(`[sync] copied ${copied} files (${bannered} with GENERATED banner)`);
}

main();
