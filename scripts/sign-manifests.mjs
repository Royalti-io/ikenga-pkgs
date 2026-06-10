#!/usr/bin/env node
/**
 * sign-manifests — embed a minisign signature into each pkg's on-disk
 * `manifest.json` so the PUBLISHED TARBALL ships a signed manifest (ADR-017 /
 * WP-06).
 *
 * WHY this runs at VERSION/BUILD time, not at registry-update time:
 *   The shell verifies a manifest by reading `<install_path>/manifest.json`
 *   from the UNPACKED tarball and re-deriving its canonical bytes. So the
 *   signature must live INSIDE the tarball — which means it has to be embedded
 *   BEFORE `changeset publish` packs the tarball. The registry-index updater
 *   (`update-registry-index.mjs`) runs AFTER publish and only RECORDS the
 *   publisher key in the index; the actual embedding is here.
 *
 * Pipeline placement (release.yml):
 *   pnpm install → pnpm -r build
 *   → node scripts/sync-manifest-versions.mjs   (version already synced)
 *   → node scripts/sign-manifests.mjs            (THIS — embed signatures)
 *   → changesets publish                          (packs the SIGNED manifests)
 *   → update-registry-index.mjs                   (records publisherKey)
 *
 * Signature surface = CANONICAL MANIFEST JSON v1 of the manifest with its
 * `signature` field stripped (see sign-manifest.mjs / pkg/signature.rs). We
 * JSON.parse → sign the canonical bytes → write `manifest.signature = blob` →
 * JSON.stringify(pretty). Reformatting is SAFE: verification canonicalizes the
 * parsed value, so on-disk whitespace is irrelevant to the signature.
 *
 * OPT-IN: with no `PUBLISHER_SIGNING_*` env this is a no-op (logs + exits 0) so
 * a release without the publisher key still publishes — unsigned pkgs install +
 * run, they just can't reach trusted-for-elevated (Community tier). This gates
 * THIRD-PARTY trusted only; the builtin tier ships without any signature.
 *
 * Which pkgs get signed:
 *   - default: only pkgs whose manifest DECLARES an elevated capability
 *     (`capabilities.http` / `.secrets` / `.invoke`) — those are the only pkgs
 *     that benefit from a signature (it's what unlocks the elevated cap). A
 *     signature on a pkg with no elevated cap is harmless but pointless.
 *   - `--all`: sign every pkg manifest (useful once trusted is the norm).
 *
 * Required env (only when signing is desired):
 *   PUBLISHER_SIGNING_PRIVATE_KEY — minisign secret-key file CONTENTS
 *   PUBLISHER_SIGNING_PUBLIC_KEY  — matching minisign `.pub` file CONTENTS
 *   PUBLISHER_SIGNING_PASSWORD    — optional; '' for an unencrypted (`-W`) key
 *
 * Assumes `minisign` is on PATH (the workflow installs it).
 *
 * Usage:
 *   node scripts/sign-manifests.mjs            # sign elevated-cap pkgs
 *   node scripts/sign-manifests.mjs --all      # sign every pkg manifest
 *   node scripts/sign-manifests.mjs --check    # report which would sign, write nothing
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { signManifest, canonicalManifestJson, publisherKeyFromPub } from './sign-manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL = process.argv.includes('--all');
const CHECK = process.argv.includes('--check');

const PRIVATE_KEY = process.env.PUBLISHER_SIGNING_PRIVATE_KEY ?? null;
const PUBLIC_KEY = process.env.PUBLISHER_SIGNING_PUBLIC_KEY ?? null;
const PASSWORD = process.env.PUBLISHER_SIGNING_PASSWORD ?? '';

const ELEVATED_CAPS = ['http', 'secrets', 'invoke'];

/** Every packages/<type>/<pkg>/ dir holding a manifest.json. */
function findManifestDirs() {
  const out = [];
  const packagesRoot = join(REPO_ROOT, 'packages');
  for (const type of readdirSync(packagesRoot)) {
    const typeDir = join(packagesRoot, type);
    if (!statSync(typeDir).isDirectory()) continue;
    for (const pkg of readdirSync(typeDir)) {
      const dir = join(typeDir, pkg);
      if (!statSync(dir).isDirectory()) continue;
      if (existsSync(join(dir, 'manifest.json'))) out.push(dir);
    }
  }
  return out.sort();
}

/** True if the manifest declares any elevated capability. */
function declaresElevated(manifest) {
  const caps = manifest.capabilities ?? {};
  return ELEVATED_CAPS.some((c) => caps[c] != null);
}

const targets = [];
for (const dir of findManifestDirs()) {
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (ALL || declaresElevated(manifest)) {
    targets.push({ dir, manifestPath, manifest });
  }
}

if (targets.length === 0) {
  console.log(
    ALL
      ? 'No manifests found to sign.'
      : 'No pkg declares an elevated capability (capabilities.http/secrets/invoke) — nothing to sign. Use --all to sign every manifest.',
  );
  process.exit(0);
}

if (CHECK) {
  console.log(`Would sign ${targets.length} manifest(s):`);
  for (const t of targets) console.log(`  - ${relative(REPO_ROOT, t.dir)} (${t.manifest.id})`);
  process.exit(0);
}

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  const what = ALL ? 'manifest(s)' : 'manifest(s) declaring elevated caps';
  console.log(
    `Manifest signing DISABLED (no PUBLISHER_SIGNING_PRIVATE_KEY / PUBLISHER_SIGNING_PUBLIC_KEY). ` +
      `${targets.length} ${what} will publish UNSIGNED (Community tier — any elevated caps inert). ` +
      `Provision the publisher key to make them trusted-for-elevated.`,
  );
  process.exit(0);
}

const publisherKey = publisherKeyFromPub(PUBLIC_KEY);
console.log(`Signing ${targets.length} manifest(s) with publisher key ${publisherKey.slice(0, 12)}…`);

let signed = 0;
for (const { manifestPath, manifest } of targets) {
  const rel = relative(REPO_ROOT, manifestPath);

  // Sign over the canonical bytes (the `signature` field, if any, is stripped
  // inside signManifest). A previous run's signature is replaced.
  const blob = signManifest(manifest, PRIVATE_KEY, PASSWORD);

  // Embed: set the top-level `signature` to the whole `.minisig` blob, then
  // pretty-print. Reformatting is safe — verification canonicalizes the parsed
  // value, so on-disk whitespace doesn't affect the signed bytes.
  const out = { ...manifest, signature: blob };
  writeFileSync(manifestPath, `${JSON.stringify(out, null, 2)}\n`);

  // Self-check: the bytes we just signed must canonicalize identically whether
  // we read the signature back or not (strip-`signature` is unconditional).
  const reparsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (canonicalManifestJson(reparsed) !== canonicalManifestJson(manifest)) {
    console.error(`✗ ${rel}: canonical bytes changed after embedding signature — refusing to publish a broken signature`);
    process.exit(1);
  }

  signed++;
  console.log(`✓ ${rel} (${manifest.id}) signed`);
}

console.log(`\n${signed} manifest(s) signed. publisherKey = ${publisherKey}`);
