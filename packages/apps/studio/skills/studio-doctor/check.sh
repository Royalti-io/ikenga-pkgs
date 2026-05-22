#!/usr/bin/env bash
# studio-doctor preflight. Required deps fail (exit 1); optional deps warn (exit 0).
set -u

req_missing=0

check_required() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  %-22s ok\n' "$name"
  else
    printf '  %-22s MISSING (required)\n' "$name"
    req_missing=1
  fi
}

check_optional() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  %-22s ok\n' "$name"
  else
    printf '  %-22s MISSING (optional)\n' "$name"
  fi
}

# Chromium can be any of several binaries, or a Puppeteer-bundled one.
chromium_present() {
  command -v chromium >/dev/null 2>&1 \
    || command -v chromium-browser >/dev/null 2>&1 \
    || command -v google-chrome >/dev/null 2>&1 \
    || command -v google-chrome-stable >/dev/null 2>&1 \
    || [ -n "${PUPPETEER_EXECUTABLE_PATH:-}" ]
}

echo "studio-doctor — toolchain preflight"
echo "required:"
check_required "ffmpeg"   command -v ffmpeg
check_required "chromium" chromium_present
check_required "bun"      command -v bun
echo "optional (music-video / studio-beat-detect):"
check_optional "python3"  command -v python3
check_optional "librosa"  python3 -c "import librosa"

echo "---"
if [ "$req_missing" -ne 0 ]; then
  echo "summary: a REQUIRED dependency is missing — fix before building."
  exit 1
fi
echo "summary: all required deps present (optional warnings, if any, are safe to ignore unless building music videos)."
exit 0
