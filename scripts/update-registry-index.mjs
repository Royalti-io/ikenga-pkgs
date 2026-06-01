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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_REPO = 'Royalti-io/ikenga-registry';

const REQUIRED_ENV = ['PUBLISHED', 'REGISTRY_REPO_PAT', 'REGISTRY_SIGNING_PRIVATE_KEY'];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`✗ missing required env: ${k}`);
    process.exit(1);
  }
}

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

/** `@ikenga/pkg-engine-claude-code` → `engine-claude-code` */
function shortName(npmName) {
  return npmName.replace(/^@ikenga\//, '').replace(/^pkg-/, '');
}

/** Find local package.json directory for a given npm name. */
function findPackageDir(npmName) {
  const packagesRoot = join(REPO_ROOT, 'packages');
  for (const type of readdirSync(packagesRoot)) {
    const typeDir = join(packagesRoot, type);
    if (!statSync(typeDir).isDirectory()) continue;
    for (const folder of readdirSync(typeDir)) {
      const pkgDir = join(typeDir, folder);
      const pkgJsonPath = join(pkgDir, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;
      const pj = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (pj.name === npmName) return pkgDir;
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

for (const { name, version } of published) {
  const short = shortName(name);
  const pkgDir = findPackageDir(name);
  // Libraries shipped from this monorepo (e.g. @ikenga/registry-client) get
  // published to npm but aren't installable Ikenga pkgs — they have no
  // manifest.json. Skip them; the registry only catalogs installable pkgs.
  const manifestPath = join(pkgDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.log(`Skipping ${name}@${version}: no manifest.json (library publish, not a pkg)`);
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
  };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    index.pkgs.push(entry);
    index.pkgs.sort((a, b) => a.name.localeCompare(b.name));
  }
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

// Commit + push
const pkgList = published.map((p) => `${p.name}@${p.version}`).join(', ');
execSync(`git -C ${registryDir} add -A`);
const commitMsg = `chore: publish ${published.length} pkg version(s)\n\n${published.map((p) => `- ${p.name}@${p.version}`).join('\n')}`;
execSync(`git -C ${registryDir} commit -m ${JSON.stringify(commitMsg)}`, { stdio: ['ignore', 'inherit', 'inherit'] });
execSync(`git -C ${registryDir} push origin main`, { stdio: ['ignore', 'inherit', 'inherit'] });

console.log(`✓ registry updated: ${pkgList}`);
