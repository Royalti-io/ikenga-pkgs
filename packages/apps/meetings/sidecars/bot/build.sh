#!/usr/bin/env bash
# Build the com.ikenga.meetings recorder sidecar as a node-runnable ESM bundle
# with a #!/usr/bin/env node shebang.
#
# ── Why the sidecar is built INTO the app package ────────────────────────────
#
# `host.pkgSidecarCall` → `pkg_sidecar_call` refuses any sidecar whose
# `entry.pkg_id` differs from the calling pkg, and the sidecars registry only
# accepts a binary that resolves UNDER the declaring package's install dir
# (shell/src-tauri/src/pkg/registries/sidecars.rs). A sidecar shipped as its own
# separate package therefore cannot be invoked by this app at all. The source of
# truth stays in packages/sidecars/meetings-bot; this script bundles it to a
# single file inside the app package so the manifest can legally declare it.
#
# ── Why node, not bun ────────────────────────────────────────────────────────
#
# The recorder spawns `ffmpeg` and `whisper-cli` and relies on node's detached
# child semantics. Under a bun-compiled binary `process.execPath` points at the
# bundle, so resolving system binaries breaks — the same trap documented for the
# studio sidecar.
set -euo pipefail

cd "$(dirname "$0")"

SRC="../../../../sidecars/meetings-bot/src/sidecar.ts"
mkdir -p dist
OUTPUT="dist/sidecar.js"
TMP="dist/.sidecar.tmp.js"

WATCH_FLAG=""
if [[ "${1:-}" == "--watch" ]]; then
  WATCH_FLAG="--watch"
fi

echo "==> bundling $OUTPUT from $SRC (target: node, format: esm)"
bun build $WATCH_FLAG \
  --target=node \
  --format=esm \
  "$SRC" \
  --outfile "$TMP"

{
  echo '#!/usr/bin/env node'
  cat "$TMP"
} > "$OUTPUT"
chmod +x "$OUTPUT"
rm "$TMP"

echo "==> built $(pwd)/$OUTPUT"
