#!/usr/bin/env bash
# Build the pa-com-ikenga-tsserver-lsp-bridge sidecar binary for the host
# target (or the one passed as $1). Mirrors pa-hyperframes-sidecar/build.sh
# but writes a single binary; no wrapper UI here.

set -euo pipefail

cd "$(dirname "$0")"

TARGET="${1:-$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')}"
if [[ -z "${TARGET:-}" ]]; then
  echo "error: could not infer target triple; pass it as arg 1" >&2
  exit 1
fi

# Bundle to a Node-runnable script with a #!/usr/bin/env node shebang. Why
# not `--compile`? Bun-compiled binaries handle Tokio-piped stdin
# unreliably on this platform — the process exits before reading the first
# line. Shipping a node-runnable bundle bypasses that and stays portable
# across linux/macos/win as long as `node` is on PATH at runtime.

mkdir -p dist
OUTPUT="dist/pa-com-ikenga-tsserver-lsp-bridge"
TMP="dist/.bridge.tmp.cjs"

echo "==> bundling $OUTPUT (target: node, format: esm)"
bun build --target=node --format=esm --minify src/bridge.ts --outfile "$TMP"

# Prepend shebang — bun build doesn't add one for plain ESM outputs.
{
  echo '#!/usr/bin/env node'
  cat "$TMP"
} > "$OUTPUT"
rm "$TMP"
chmod +x "$OUTPUT"
echo "==> done: $(du -h "$OUTPUT" | cut -f1) $OUTPUT"
