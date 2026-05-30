#!/usr/bin/env node
/**
 * lift-requires — compile each skill package's `SKILL.md` `depends_on` (the G-04
 * authoring star) into the manifest's `requires` field (Ọba forward-dependency
 * resolution, ADR-015 §3a / WP-12).
 *
 * WHY: `depends_on` is the *authoring* edge a skill author writes in SKILL.md
 * frontmatter; it may only target `skill-core` (G-04, lint-enforced here). Ọba
 * reads ONLY the compiled `requires` on the manifest/registry — it never parses
 * SKILL.md — which keeps the registry agnostic to skill *format*. This script is
 * the lift that bridges the two: SKILL.md `depends_on` → manifest `requires`.
 *
 * WHAT IT DOES, per package under `packages/skills/<pkg>/` that has a manifest:
 *   1. Read every `skills/<name>/SKILL.md`, parse its frontmatter `depends_on`.
 *   2. Enforce G-04: every `depends_on` entry MUST be `skill-core` (anything
 *      else is a hard error — the lift never manufactures a skill→non-core edge).
 *   3. Union + dedupe the targets across all SKILL.md in the package.
 *   4. Compile → `requires: [{ kind: 'skill', name: <target> }]` and write it
 *      into the committed `manifest.json`. Empty deps ⇒ the `requires` key is
 *      OMITTED (absent = no deps, matches the schema default), so only packages
 *      that actually depend on something carry the field.
 *
 * The catalog half is automatic: `scripts/update-registry-index.mjs` embeds the
 * whole `manifest` object into the published catalog detail (`pkgs/<short>.json`),
 * so `requires` flows to the catalog entry once it's on the manifest.
 *
 * Idempotent: re-running produces byte-identical output (sorted, deduped).
 *
 * Usage:
 *   node scripts/lift-requires.mjs           # write requires into manifests
 *   node scripts/lift-requires.mjs --check    # verify in-sync; exit 1 on drift (CI)
 *
 * Wire into pre-publish: add `"prepublishOnly": "node scripts/lift-requires.mjs --check"`
 * (or run `pnpm lift:requires` before `changeset version`) so a manifest can
 * never publish with a stale `requires`.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_ROOT = join(REPO_ROOT, 'packages', 'skills');

/** The ONLY legal `depends_on` target (G-04 star). */
const STAR_HUB = 'skill-core';

// ── frontmatter `depends_on` extraction ──────────────────────────────────────
// We parse only what we need (depends_on) rather than pull in a YAML dep, so the
// script stays zero-dependency. Handles the three shapes that appear in our
// SKILL.md frontmatter:
//   depends_on: []
//   depends_on: [skill-core]            (inline flow)
//   depends_on:\n  - skill-core         (block list)

/** Extract the YAML frontmatter block (between the first two `---` fences). */
export function frontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

/** Strip surrounding quotes + whitespace from a scalar. */
function clean(s) {
  return s.trim().replace(/^['"]|['"]$/g, '').trim();
}

/** Parse `depends_on` out of a frontmatter string → string[] (possibly empty). */
export function parseDependsOn(fm) {
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^depends_on:\s*(.*)$/);
    if (!m) continue;
    const rest = m[1].trim();
    // inline forms: `[]`, `[a, b]`
    if (rest.startsWith('[')) {
      const inner = rest.replace(/^\[|\]$/g, '').trim();
      if (!inner) return [];
      return inner.split(',').map(clean).filter(Boolean);
    }
    if (rest && rest !== '|' && rest !== '>') {
      // a scalar on the same line (unusual) — treat as a single value
      return [clean(rest)];
    }
    // block list: subsequent `  - value` lines until indentation drops
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*-\s+/.test(l)) {
        out.push(clean(l.replace(/^\s*-\s+/, '')));
      } else if (/^\s*$/.test(l)) {
        continue; // blank line inside the block
      } else if (/^\S/.test(l)) {
        break; // next top-level key
      } else {
        break;
      }
    }
    return out.filter(Boolean);
  }
  return []; // no depends_on key at all
}

// ── per-package lift ──────────────────────────────────────────────────────────

/** All `SKILL.md` files under a package's `skills/` tree. */
function skillMdFiles(pkgDir) {
  const skillsDir = join(pkgDir, 'skills');
  if (!existsSync(skillsDir)) return [];
  const out = [];
  for (const name of readdirSync(skillsDir)) {
    const p = join(skillsDir, name, 'SKILL.md');
    if (existsSync(p) && statSync(p).isFile()) out.push(p);
  }
  return out;
}

/**
 * Compute the compiled `requires` for one package.
 * Returns { requires, deps } or throws on a G-04 violation.
 */
export function computeRequires(pkgDir) {
  const targets = new Set();
  for (const md of skillMdFiles(pkgDir)) {
    const deps = parseDependsOn(frontmatter(readFileSync(md, 'utf8')));
    for (const d of deps) {
      if (d !== STAR_HUB) {
        throw new Error(
          `G-04 violation in ${md}: depends_on may only target '${STAR_HUB}', found '${d}'`,
        );
      }
      targets.add(d);
    }
  }
  const requires = [...targets]
    .sort()
    .map((name) => ({ kind: 'skill', name }));
  return requires;
}

/** Deep-equal two `requires` arrays (order-insensitive by kind+name). */
export function requiresEqual(a, b) {
  const norm = (arr) =>
    [...arr]
      .map((r) => JSON.stringify({ kind: r.kind, name: r.name, source: r.source, ref: r.ref }))
      .sort()
      .join('|');
  return norm(a) === norm(b);
}

/** Serialize a `requires` array as a top-level manifest key (2-space indent). */
function serializeRequires(requires) {
  const items = requires
    .map((r) => {
      const fields = [`      "kind": ${JSON.stringify(r.kind)}`, `      "name": ${JSON.stringify(r.name)}`];
      if (r.source) fields.push(`      "source": ${JSON.stringify(r.source)}`);
      if (r.ref) fields.push(`      "ref": ${JSON.stringify(r.ref)}`);
      return `    {\n${fields.join(',\n')}\n    }`;
    })
    .join(',\n');
  return `"requires": [\n${items}\n  ]`;
}

/**
 * Apply `requires` to the raw manifest TEXT surgically: strip any existing
 * top-level `requires` block (and its adjoining comma), then, if non-empty,
 * inject the compiled block as the LAST key before the closing brace. The rest
 * of the file's formatting is preserved byte-for-byte. Deterministic ⇒ idempotent.
 */
export function applyRequires(raw, requires) {
  // Strip an existing top-level `requires` (flat array of objects — the first
  // `]` closes it). Consume an adjoining comma on either side so we never leave
  // a dangling one.
  let s = raw.replace(/,?\s*"requires"\s*:\s*\[[\s\S]*?\]\s*,?/, (m) =>
    // keep a single comma if the match had one on BOTH sides (mid-object)
    /^,/.test(m) && /,\s*$/.test(m) ? ',' : '',
  );
  if (requires.length === 0) return s.endsWith('\n') ? s : s + '\n';
  const idx = s.lastIndexOf('}');
  const head = s.slice(0, idx).replace(/\s*$/, '');
  const tail = s.slice(idx); // closing brace + trailing newline
  const out = `${head},\n  ${serializeRequires(requires)}\n${tail}`;
  return out.endsWith('\n') ? out : out + '\n';
}

/** Lift one package's manifest. Returns { changed, requires } (no write in checkOnly). */
export function liftPackage(pkgDir, { checkOnly = false } = {}) {
  const manifestPath = join(pkgDir, 'manifest.json');
  if (!existsSync(manifestPath)) return { skipped: true };
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const requires = computeRequires(pkgDir);
  const current = Array.isArray(manifest.requires) ? manifest.requires : [];

  // Decide on the SEMANTIC requires value, not raw bytes — so a manifest whose
  // requires is already correct is never rewritten/reformatted.
  const changed = !requiresEqual(current, requires);
  if (changed && !checkOnly) writeFileSync(manifestPath, applyRequires(raw, requires));
  return { changed, requires, manifestPath };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const checkOnly = process.argv.includes('--check');
  const pkgs = readdirSync(SKILLS_ROOT).filter((n) =>
    existsSync(join(SKILLS_ROOT, n, 'manifest.json')),
  );
  let drift = 0;
  for (const pkg of pkgs) {
    const pkgDir = join(SKILLS_ROOT, pkg);
    const res = liftPackage(pkgDir, { checkOnly });
    if (res.skipped) continue;
    const reqStr = res.requires.length
      ? res.requires.map((r) => r.name).join(', ')
      : '(none)';
    if (res.changed) {
      drift++;
      console.log(`${checkOnly ? 'DRIFT' : 'wrote'}  ${pkg} → requires: ${reqStr}`);
    } else {
      console.log(`ok     ${pkg} → requires: ${reqStr}`);
    }
  }
  if (checkOnly && drift > 0) {
    console.error(
      `\n✗ ${drift} manifest(s) out of sync with SKILL.md depends_on. Run \`pnpm lift:requires\`.`,
    );
    process.exit(1);
  }
  console.log(`\n✓ lift-requires ${checkOnly ? 'check' : 'done'} (${pkgs.length} skill pkgs).`);
}

// Only run main() when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
