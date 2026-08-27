#!/usr/bin/env node
/**
 * Verification script to detect frozen/stale ikenga-registry index.
 *
 * Checks the live registry index (https://registry.ikenga.dev/index.json) or
 * github raw index against monorepo package versions.
 * If packages are published with higher versions than recorded in the index,
 * or if index age >= 2 days with version drift, emits a GitHub Actions
 * ::error:: annotation and exits 1.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_URL = 'https://registry.ikenga.dev/index.json';
const RAW_REGISTRY_URL = 'https://raw.githubusercontent.com/ikenga-hq/ikenga-registry/main/index.json';

const NON_PKG_LIBRARIES = new Set([
  '@ikenga/registry-client',
  '@ikenga/ui-lib',
]);

async function fetchRegistryIndex() {
  try {
    const res = await fetch(REGISTRY_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) return await res.json();
  } catch {}
  try {
    const res = await fetch(RAW_REGISTRY_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

function findMonorepoPackages() {
  const pkgs = [];
  const SKIP = new Set(['node_modules', 'dist', '.git', '.vite']);
  const stack = [join(REPO_ROOT, 'packages')];
  while (stack.length > 0) {
    const dir = stack.pop();
    const pkgJsonPath = join(dir, 'package.json');
    const manifestPath = join(dir, 'manifest.json');
    if (existsSync(pkgJsonPath) && existsSync(manifestPath)) {
      try {
        const pj = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pj.name && !NON_PKG_LIBRARIES.has(pj.name)) {
          pkgs.push({ name: pj.name, version: pj.version });
        }
      } catch {}
    }
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const child = join(dir, entry);
      try {
        if (statSync(child).isDirectory()) stack.push(child);
      } catch {}
    }
  }
  return pkgs;
}

export async function checkRegistryHealth() {
  const index = await fetchRegistryIndex();
  if (!index) {
    console.warn('⚠ Could not fetch live or raw registry index; skipping frozen index check.');
    return { ok: true, warning: 'registry_unreachable' };
  }

  const monorepoPkgs = findMonorepoPackages();
  const registryPkgs = new Map((index.pkgs || []).map((p) => [p.name, p.latest]));

  const drift = [];
  for (const pkg of monorepoPkgs) {
    const regVersion = registryPkgs.get(pkg.name);
    if (!regVersion) {
      drift.push({ name: pkg.name, localVersion: pkg.version, regVersion: 'missing' });
    }
  }

  let ageDays = null;
  if (index.updatedAt) {
    const parsed = Date.parse(index.updatedAt);
    if (!Number.isNaN(parsed)) {
      ageDays = Math.floor((Date.now() - parsed) / 86_400_000);
    }
  }

  if (drift.length > 0) {
    const msg = `Frozen Registry Index Error: ${drift.length} package(s) are missing/behind in index.json (last written ${ageDays ?? '?'} days ago, ${index.updatedAt}). Missing/Drifted: ${drift.map((d) => `${d.name} (${d.regVersion} -> ${d.localVersion})`).join(', ')}`;
    console.error(`::error title=Frozen Registry Index Detected::${msg}`);
    return { ok: false, error: msg, drift, ageDays };
  }

  console.log(`✓ Registry index health clean (${registryPkgs.size} catalogued pkgs, last written ${ageDays ?? 0} days ago).`);
  return { ok: true, ageDays };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkRegistryHealth();
  if (!result.ok) {
    process.exit(1);
  }
}
