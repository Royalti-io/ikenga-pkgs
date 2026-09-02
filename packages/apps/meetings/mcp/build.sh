#!/usr/bin/env bash
# Build the com.ikenga.meetings long-lived MCP server as a node-runnable ESM bundle
# with a #!/usr/bin/env node shebang.
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p dist
OUTPUT="dist/index.js"
TMP="dist/.index.tmp.js"

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

{
  echo '#!/usr/bin/env node'
  cat "$TMP"
} > "$OUTPUT"
rm "$TMP"
chmod +x "$OUTPUT"

echo "==> built $(pwd)/$OUTPUT"
