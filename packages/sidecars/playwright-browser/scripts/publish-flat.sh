#!/usr/bin/env bash
# Publish @ikenga/pkg-browser with a clean, kernel-installable
# tarball.
#
# WHY THIS EXISTS (not changesets / pnpm publish): the pkg vendors Playwright via
# `bundledDependencies`. Under the pnpm monorepo the store is symlinked, and BOTH
# `npm pack` (follows the symlink → emits `../../../` path-traversal entries the
# kernel's extract_tarball REJECTS) and `pnpm pack` (errors "Add
# node-linker=hoisted … or delete bundledDependencies") produce a broken/empty
# tarball. The only clean path is a FLAT `npm install` (no pnpm symlinks) then
# `npm pack`/`npm publish`. So this pkg is in `.changeset/config.json` `ignore`
# and ships out-of-band via this script.
#
# Usage:
#   bash scripts/publish-flat.sh           # build + flat-install + pack + VERIFY (no publish)
#   PUBLISH=1 bash scripts/publish-flat.sh # …then `npm publish` (needs an npm token in ~/.npmrc)
set -euo pipefail

cd "$(dirname "$0")/.."
PKG_DIR="$(pwd)"
echo "==> $PKG_DIR"

echo "==> 1/4 build dist/sidecar.js"
bun run build

echo "==> 2/4 flat npm install (no pnpm symlinks)"
rm -rf node_modules
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund

echo "==> 3/4 npm pack + verify the tarball is kernel-installable"
TGZ="$(npm pack 2>/dev/null | tail -1)"
DOTDOT="$(tar tzf "$TGZ" | grep -c '\.\.' || true)"
CORE="$(tar tzf "$TGZ" | grep -c 'node_modules/playwright-core/package.json' || true)"
echo "    tarball=$TGZ  size=$(du -h "$TGZ" | cut -f1)  '..'-entries=$DOTDOT  playwright-core=$CORE"
if [[ "$DOTDOT" != "0" || "$CORE" -lt 1 ]]; then
  echo "    FAIL: tarball not kernel-installable ('..'=$DOTDOT, playwright-core=$CORE). Aborting." >&2
  rm -f "$TGZ"; exit 1
fi
# prove a kernel-style extract runs
E="$(mktemp -d)"; tar xzf "$TGZ" --strip-components=1 -C "$E"
( cd "$E" && IKENGA_PW_HEADLESS=1 IKENGA_PW_PORT=0 timeout 8 node dist/sidecar.js & sleep 4 ) 2>&1 | grep -q 'IKENGA_PW_READY' \
  && echo "    extract+run OK (IKENGA_PW_READY)" || { echo "    FAIL: extracted sidecar did not start" >&2; rm -rf "$E" "$TGZ"; exit 1; }
pkill -f "$E/dist/sidecar.js" 2>/dev/null || true; rm -rf "$E"

echo "==> 4/4 publish"
if [[ "${PUBLISH:-0}" == "1" ]]; then
  npm publish "$TGZ" --access public
  echo "    published."
else
  echo "    DRY RUN — verified tarball $TGZ is ready. Re-run with PUBLISH=1 to publish."
  echo "    (then add the signed registry-index entry per ADR-017 — shell.execute:[node] needs provenance trust.)"
fi
