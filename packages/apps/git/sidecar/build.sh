#!/usr/bin/env bash
# Build the com.ikenga.git sidecar as a node-runnable ESM bundle with a
# `#!/usr/bin/env node` shebang.
#
# DO NOT use `bun --compile` (see the studio sidecar's build.sh / plans/studio
# G18): a compiled bun sets process.execPath to the bundle, so spawn('git', …)
# and spawn('gh', …) — the whole point of this sidecar — cannot resolve the
# system binaries; and piped-stdin handling is flaky under compiled bun, which
# would silently drop this sidecar's JSON-RPC-over-stdio frames.
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p dist
OUTPUT="dist/sidecar.js"
TMP="dist/.sidecar.tmp.js"

WATCH_FLAG=""
if [[ "${1:-}" == "--watch" ]]; then
  WATCH_FLAG="--watch"
fi

echo "==> bundling $OUTPUT (target: node, format: esm)"
bun build $WATCH_FLAG \
  --target=node \
  --format=esm \
  src/index.ts \
  --outfile "$TMP"

# Prepend shebang — bun build doesn't add one for plain ESM outputs.
{
  echo '#!/usr/bin/env node'
  cat "$TMP"
} > "$OUTPUT"
rm "$TMP"
chmod +x "$OUTPUT"

echo "==> done: $(du -h "$OUTPUT" | cut -f1) $OUTPUT"
