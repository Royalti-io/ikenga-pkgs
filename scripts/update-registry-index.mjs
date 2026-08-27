#!/usr/bin/env node
/**
 * Update the ikenga-registry static catalog with newly published packages.
 *
 * Invoked by .github/workflows/release.yml after changesets/action reports
 * `published == 'true'`. Receives `$PUBLISHED` — the JSON value of
 * `steps.changesets.outputs.publishedPackages`, an array of { name, version }.
 *
 * For each published package:
 *   1. Fetch dist metadata from npm (tarball, integrity, publishedAt).
 *   2. Read the local manifest.json + package.json (this commit IS the
 *      published source, so they're authoritative for this version).
 *   3. Update or create `pkgs/<short>.json` in the registry repo (prepend
 *      the new version; newest-first).
 *   4. Update `index.json` (refresh `latest` for this pkg).
 *
 * Then re-sign `index.json` with the registry minisign key, commit, push.
 *
 * Required env:
 *   PUBLISHED                     — JSON array from changesets/action
 *   REGISTRY_REPO_PAT             — fine-grained PAT with contents:write on ikenga-registry
 *   REGISTRY_SIGNING_PRIVATE_KEY  — multi-line minisign secret key file contents
 *
 * Assumes `minisign` is on PATH (the workflow installs it).
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync as wf } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

import { publisherKeyFromPub } from './sign-manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_REPO = 'ikenga-hq/ikenga-registry';

const REQUIRED_ENV = ['PUBLISHED', 'REGISTRY_REPO_PAT', 'REGISTRY_SIGNING_PRIVATE_KEY'];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`✗ missing required env: ${k}`);
    process.exit(1);
  }
}

/**
 * Publisher PUBLIC key (ADR-017 / WP-06). DISTINCT from the registry index
 * signing key: the index key (`REGISTRY_SIGNING_PRIVATE_KEY`) signs `index.json`
 * — "this catalog is from us"; the publisher key signs each pkg's MANIFEST —
 * "these declared capabilities are the bytes the publisher approved", which is
 * what the shell's trust gate (`is_trusted_for_elevated`) verifies before
 * granting elevated caps (host.fetch / named secrets / scoped invoke).
 *
 * This script only RECORDS the binding: the manifests were signed (the private
 * key, in the separate `sign-manifests.mjs` step that runs BEFORE the tarball is
 * packed), and here we bind the matching PUBLIC key into the release-key-signed
 * index entry. So only the public key is needed.
 *
 * OPT-IN: when unset, a signed manifest publishes WITHOUT a `publisherKey`
 * binding — the shell's verifier then returns `MissingPublisherKey` (fail-closed,
 * Community tier). An unsigned manifest publishes unsigned regardless. This
 * gates THIRD-PARTY trusted only; the builtin tier ships without any signature.
 *
 *   PUBLISHER_SIGNING_PUBLIC_KEY — the minisign `.pub` file CONTENTS; its base64
 *                                  payload is recorded as the index entry's
 *                                  `publisherKey`.
 */
const PUBLISHER_SIGNING_PUBLIC_KEY = process.env.PUBLISHER_SIGNING_PUBLIC_KEY ?? null;
const PUBLISHER_KEY = PUBLISHER_SIGNING_PUBLIC_KEY
  ? publisherKeyFromPub(PUBLISHER_SIGNING_PUBLIC_KEY)
  : null;
console.log(
  PUBLISHER_KEY
    ? `Publisher key configured (${PUBLISHER_KEY.slice(0, 12)}…) — signed manifests get a publisherKey binding.`
    : 'No PUBLISHER_SIGNING_PUBLIC_KEY — signed manifests publish WITHOUT a publisherKey binding (Community tier).',
);

const published = JSON.parse(process.env.PUBLISHED);
if (!Array.isArray(published) || published.length === 0) {
  console.log('No packages published — nothing to do.');
  process.exit(0);
}
console.log(`Updating registry for ${published.length} published pkg(s):`);
for (const p of published) console.log(`  - ${p.name}@${p.version}`);

/**
 * Catalog curation: pkgs kept installable (by exact name) but HIDDEN from the
 * default browse/catalog surfaces. Dev/test fixtures + non-functional
 * scaffolds. Reconciled across the whole index on every publish (below), so
 * adding/removing a name here takes effect on the next publish — no manual
 * re-sign needed.
 */
const HIDDEN_PKGS = new Set([
  '@ikenga/pkg-hello', // registry-pipeline smoke fixture
  '@ikenga/pkg-engine-noop', // test fixture / shell-without-AI mode
  '@ikenga/pkg-engine-cursor-agent', // scaffold-only; runtime stubbed (ADR-013 Phase 4)
]);

/**
 * Packages published from this monorepo that are deliberately NOT installable
 * Ikenga pkgs — plain npm libraries, consumed as dependencies, with no
 * manifest.json and no catalog entry.
 *
 * This list exists because "has no manifest.json" used to be treated on its own
 * as proof of library-hood, and that inference is wrong in the one direction
 * that matters: a real pkg whose manifest is missing looks identical to a
 * library. `@ikenga/skill-groundwork@0.6.0` published on 2026-08-04, hit that
 * branch, and was skipped — while the run still re-signed the index and
 * committed "- @ikenga/skill-groundwork@0.6.0", so the failure left behind
 * evidence that it had succeeded. Naming the libraries explicitly means an
 * unrecognised pkg without a manifest is now an error instead of a shrug.
 */
const NON_PKG_LIBRARIES = new Set([
  '@ikenga/registry-client', // registry resolver client, consumed by the shell
  '@ikenga/ui-lib', // shared React components, consumed by app pkgs
]);

/** `@ikenga/pkg-engine-claude-code` → `engine-claude-code` */
function shortName(npmName) {
  return npmName.replace(/^@ikenga\//, '').replace(/^pkg-/, '');
}

/**
 * Find local package.json directory for a given npm name.
 *
 * Walks `packages/` recursively rather than a fixed two levels: nested
 * workspace members like `@ikenga/studio-schema` live at
 * `packages/apps/studio/shared` (a sub-package of the studio app), which the
 * old `packages/<type>/<folder>` walk never reached — so any batch that
 * published such a member crashed here before the catalog was committed. These
 * nested members are usually libraries (no `manifest.json`) and get skipped by
 * the caller; the point of finding them is to NOT throw. node_modules/dist are
 * pruned so we never match a hoisted dependency's package.json.
 */
function findPackageDir(npmName) {
  const SKIP = new Set(['node_modules', 'dist', '.git', '.vite']);
  const stack = [join(REPO_ROOT, 'packages')];
  while (stack.length > 0) {
    const dir = stack.pop();
    const pkgJsonPath = join(dir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pj = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pj.name === npmName) return dir;
      } catch {
        // unparseable package.json — ignore and keep walking
      }
    }
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const child = join(dir, entry);
      if (statSync(child).isDirectory()) stack.push(child);
    }
  }
  throw new Error(`Could not locate local package dir for ${npmName}`);
}

async function npmDistInfo(name, version) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/${version}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`npm fetch failed for ${name}@${version}: ${res.status}`);
  const data = await res.json();
  // Sibling endpoint for publish time:
  const timeRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`);
  const timeData = await timeRes.json();
  return {
    tarball: data.dist.tarball,
    integrity: data.dist.integrity,
    size: data.dist.unpackedSize,
    publishedAt: timeData.time?.[version] ?? new Date().toISOString(),
  };
}

function ikengaDeps(packageJson) {
  const deps = packageJson.dependencies ?? {};
  const out = [];
  for (const [name, range] of Object.entries(deps)) {
    if (name.startsWith('@ikenga/pkg-')) {
      out.push({ name, range });
    }
  }
  return out;
}

/**
 * For a `kind:"bundle"` pkg (Ọba WP-18/22), derive its member skill leaves from
 * the on-disk `skills/<member>/` subdirs. The catalog carries this so the Ọba
 * resolver can expand a bundle into its members — and the consent UX can list
 * "also installs N skills" — WITHOUT fetching the tarball (WP-20). Returns
 * `undefined` for non-bundle pkgs so their catalog entries stay byte-identical.
 */
function bundleMembers(pkgDir, manifest) {
  if (manifest.kind !== 'bundle') return undefined;
  const skillsDir = join(pkgDir, 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((m) => statSync(join(skillsDir, m)).isDirectory())
    .sort();
}

// Clone the registry repo into a tempdir using the PAT
const tmp = mkdtempSync(join(tmpdir(), 'ikenga-registry-'));
const registryDir = join(tmp, 'ikenga-registry');
// Works for both fine-grained PATs and classic tokens
const cloneUrl = `https://oauth2:${process.env.REGISTRY_REPO_PAT}@github.com/${REGISTRY_REPO}.git`;
execSync(`git clone --depth=1 ${cloneUrl} ${registryDir}`, { stdio: ['ignore', 'inherit', 'inherit'] });
execSync(`git -C ${registryDir} config user.name "ikenga-pkgs[bot]"`);
execSync(`git -C ${registryDir} config user.email "ikenga-pkgs+bot@users.noreply.github.com"`);

const indexPath = join(registryDir, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));

const nowIso = new Date().toISOString();

/** Successfully written into the catalog this run — drives the commit message. */
const catalogued = [];
/** Published, expected to be catalogued, but had no manifest.json. Fails the run. */
const uncatalogued = [];

for (const { name, version } of published) {
  const short = shortName(name);
  const pkgDir = findPackageDir(name);
  // Libraries shipped from this monorepo get published to npm but aren't
  // installable Ikenga pkgs — they have no manifest.json. They must be named in
  // NON_PKG_LIBRARIES: a missing manifest on anything else is a packaging bug
  // (the pkg is on npm but uninstallable through the registry), not a library,
  // and silently skipping it is what let five pkgs go uncatalogued.
  const manifestPath = join(pkgDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    if (NON_PKG_LIBRARIES.has(name)) {
      console.log(`Skipping ${name}@${version}: known library publish, not a pkg.`);
      continue;
    }
    console.error(
      `✗ ${name}@${version}: published to npm but has no manifest.json, so it cannot be catalogued.\n` +
        `  Add ${join(pkgDir, 'manifest.json')} if it is an installable pkg, or add the name to\n` +
        `  NON_PKG_LIBRARIES in this script if it is a plain library.`,
    );
    uncatalogued.push(`${name}@${version}`);
    continue;
  }
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Changesets bumps package.json but not manifest.json — overwrite so the
  // registry reports the actual published version.
  manifest.version = version;
  const dist = await npmDistInfo(name, version);
  const deps = ikengaDeps(pkgJson);
  // WP-22/20: a bundle pkg carries its member skill leaves so the resolver can
  // expand it without fetching the tarball. `undefined` for non-bundles.
  const members = bundleMembers(pkgDir, manifest);

  // ADR-017 / WP-06: if this manifest is signed, bind the publisher key. The
  // shell's trust gate threads this into `InstallSource::Registry.publisher_key`,
  // then re-derives the canonical bytes from the on-disk manifest.json (which
  // carries the same `signature` string we read here, embedded at sign-time
  // before the tarball was packed) and minisign-verifies. A manifest with a
  // signature but no `publisherKey` in the catalog is fail-closed Rust-side
  // (`MissingPublisherKey`), so we only bind the key when the manifest is signed
  // AND a publisher key is configured. Recorded BOTH on the per-version detail
  // (so the resolver carries it into the install step) and on the index entry
  // (so the catalog row shows the binding without a detail fetch).
  let publisherKey;
  if (manifest.signature) {
    if (!PUBLISHER_KEY) {
      console.warn(
        `⚠ ${name}@${version} carries a manifest signature but no PUBLISHER_SIGNING_PUBLIC_KEY is configured — publishing WITHOUT a publisherKey binding (untrusted-for-elevated). Configure PUBLISHER_SIGNING_* to bind it.`,
      );
    } else {
      publisherKey = PUBLISHER_KEY;
      console.log(`  ↳ signed manifest → publisherKey ${PUBLISHER_KEY.slice(0, 12)}… bound`);
    }
  }

  const detailPath = join(registryDir, 'pkgs', `${short}.json`);
  let detail;
  if (existsSync(detailPath)) {
    detail = JSON.parse(readFileSync(detailPath, 'utf8'));
    // Drop any existing entry for this version (idempotency)
    detail.versions = detail.versions.filter((v) => v.version !== version);
  } else {
    detail = { $schemaVersion: 1, name, updatedAt: nowIso, versions: [] };
    mkdirSync(dirname(detailPath), { recursive: true });
  }
  detail.versions.unshift({
    version,
    publishedAt: dist.publishedAt,
    tarball: dist.tarball,
    integrity: dist.integrity,
    size: dist.size,
    manifest,
    deps,
    ...(members ? { members } : {}),
    ...(publisherKey ? { publisherKey } : {}),
  });
  detail.updatedAt = nowIso;
  writeFileSync(detailPath, JSON.stringify(detail, null, 2) + '\n');
  console.log(`✓ ${name}@${version} → pkgs/${short}.json`);

  // Update index entry
  const existing = index.pkgs.find((e) => e.name === name);
  const entry = {
    name,
    latest: version,
    detail: `pkgs/${short}.json`,
    description: pkgJson.description,
    kind: manifest.kind,
    ...(members ? { members } : {}),
    ...(publisherKey ? { publisherKey } : {}),
  };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    index.pkgs.push(entry);
    index.pkgs.sort((a, b) => a.name.localeCompare(b.name));
  }
  catalogued.push({ name, version });
}

// Nothing reached the catalog. Re-stamping `updatedAt` and re-signing anyway is
// how the 2026-08-04 run produced a commit that named a pkg it had not written:
// the index moved, the catalog didn't. Bail before touching the registry.
if (catalogued.length === 0) {
  console.error('✗ no packages were catalogued — leaving the registry untouched.');
  for (const p of uncatalogued) console.error(`  uncatalogued: ${p}`);
  process.exit(1);
}

// Reconcile catalog visibility across ALL entries (not just the ones published
// this run) so the HIDDEN_PKGS set is self-healing: any publish re-stamps the
// flag and re-signs the index. `hidden` is omitted (not set to "public") so
// public entries stay byte-identical to before this feature.
for (const e of index.pkgs) {
  if (HIDDEN_PKGS.has(e.name)) {
    e.visibility = 'hidden';
  } else if (e.visibility) {
    delete e.visibility;
  }
}

index.updatedAt = nowIso;
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');

// Sign index.json with minisign
const keyPath = join(tmp, 'registry.key');
wf(keyPath, process.env.REGISTRY_SIGNING_PRIVATE_KEY);
// minisign needs the key with mode 600
execSync(`chmod 600 ${keyPath}`);
execSync(`minisign -Sm ${indexPath} -s ${keyPath} -W`, { stdio: ['ignore', 'inherit', 'inherit'] });

// Commit + push. The message lists what was actually written to the catalog,
// not what npm published — those differ whenever a library is skipped, and
// conflating them is what made the earlier miss invisible in the git log.
const pkgList = catalogued.map((p) => `${p.name}@${p.version}`).join(', ');
execSync(`git -C ${registryDir} add -A`);
const commitMsg = `chore: publish ${catalogued.length} pkg version(s)\n\n${catalogued.map((p) => `- ${p.name}@${p.version}`).join('\n')}\n`;
// -F - rather than -m "...": passing the message through the shell leaves the
// \n sequences uninterpreted inside double quotes, which is why every registry
// commit subject up to now carried a literal "\n\n" instead of a blank line.
execSync(`git -C ${registryDir} commit -F -`, {
  input: commitMsg,
  stdio: ['pipe', 'inherit', 'inherit'],
});
try {
  execSync(`git -C ${registryDir} push origin main`, { stdio: ['ignore', 'inherit', 'inherit'] });
} catch (err) {
  console.error(
    `::error title=Frozen Registry Index Hazard::Failed to push registry index updates to ${REGISTRY_REPO}. ` +
      `Package(s) were published to npm, but ikenga-registry index update failed! ` +
      `Check that REGISTRY_REPO_PAT secret has contents:write permissions on ${REGISTRY_REPO}.`,
  );
  process.exit(1);
}

console.log(`✓ registry updated: ${pkgList}`);

// Push the good entries first, then fail the run so the miss is visible.
if (uncatalogued.length > 0) {
  console.error(`✗ ${uncatalogued.length} published pkg(s) could not be catalogued:`);
  for (const p of uncatalogued) console.error(`  - ${p}`);
  process.exit(1);
}
