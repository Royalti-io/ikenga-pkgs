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

echo "==> bundling $OUTPUT (target: node, format: esm)"
# better-sqlite3 is a native module; mark it external so we resolve it from
# node_modules at runtime via real `require`/`import`.
bun build $WATCH_FLAG \
  --target=node \
  --format=esm \
  --external better-sqlite3 \
  --external chokidar \
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
