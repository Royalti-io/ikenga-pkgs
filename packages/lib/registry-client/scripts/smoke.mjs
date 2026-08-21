#!/usr/bin/env node
// Manual smoke check: hit the live registry, verify the signature, fetch a
// detail file, and build an install plan. Not wired into CI — run by hand:
//
//   pnpm --filter @ikenga/registry-client build
//   node packages/lib/registry-client/scripts/smoke.mjs

import {
  fetchIndex,
  fetchPkgDetail,
  resolveInstallPlan,
} from '../dist/index.js';

const REGISTRY_URL = 'https://registry.ikenga.dev/index.json';
const REGISTRY_PUBKEY =
  'RWRTqugAYXnZRgZPMyuqRNB3G41wg+AhSU2yT8nmDNNQlWQPeCfRXAvI';

const { index, indexUrl } = await fetchIndex({
  indexUrl: REGISTRY_URL,
  publicKey: REGISTRY_PUBKEY,
});
console.log(`✓ index verified (${index.pkgs.length} pkgs, updated ${index.updatedAt})`);

const noopEntry = index.pkgs.find((p) => p.name === '@ikenga/pkg-engine-noop');
if (!noopEntry) {
  console.error('engine-noop missing from index');
  process.exit(1);
}
const detail = await fetchPkgDetail({ indexUrl, entry: noopEntry });
console.log(
  `✓ engine-noop detail fetched (latest=${detail.versions[0].version}, ${detail.versions.length} versions)`,
);

const plan = await resolveInstallPlan({
  root: detail,
  fetchDetail: (name) => fetchPkgDetail({ indexUrl, entry: { name } }),
});
console.log(`✓ install plan: ${plan.length} steps`);
for (const step of plan) {
  console.log(
    `  - ${step.name}@${step.version} → ${step.pkgId} (${step.isDep ? 'dep' : 'root'})`,
  );
  console.log(`    tarball:   ${step.tarball}`);
  console.log(`    integrity: ${step.integrity.slice(0, 24)}…`);
}
console.log('\n✓ all good');
