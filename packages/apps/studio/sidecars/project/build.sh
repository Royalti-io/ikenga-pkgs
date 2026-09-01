#!/usr/bin/env bash
# Build the com.ikenga.studio project sidecar as a node-runnable ESM bundle
# with a #!/usr/bin/env node shebang.
#
# DO NOT use `bun --compile` (Round 8 / G18, see plans/studio/08-tsserver-stdin-eof-bug.md):
#  - compiled bun sets process.execPath to the bundle, so spawn('node', …)
#    and spawn('ffmpeg', …) cannot resolve the system binary;
#  - piped-stdin handling is flaky under compiled bun, and this sidecar
#    reads JSON-RPC frames from stdin, so frames would silently drop.

set -euo pipefail

cd "$(dirname "$0")"

mkdir -p dist
OUTPUT="dist/sidecar.js"
TMP="dist/.sidecar.tmp.js"

WATCH_FLAG=""
if [[ "${1:-}" == "--watch" ]]; then
  WATCH_FLAG="--watch"
fi

echo "==> bundling $OUTPUT (target: bun, format: esm)"
bun build $WATCH_FLAG \
  --target=bun \
  --format=esm \
  --external chokidar \
  --external esbuild \
  src/index.ts \
  --outfile "$TMP"

# Prepend shebang — bun build doesn't add one for plain ESM outputs.
{
  echo '#!/usr/bin/env bun'
  cat "$TMP"
} > "$OUTPUT"
chmod +x "$OUTPUT"
rm "$TMP"

echo "==> done: $(du -h "$OUTPUT" | cut -f1) $OUTPUT"
