#!/usr/bin/env bash
# CORS + features preview verification — 2026-05-28
set -euo pipefail

R2_BASE="${R2_BASE:-https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev}"
SITE="${SITE:-https://www.2mrrw.com}"
ORIGIN="${ORIGIN:-https://www.2mrrw.com}"

probe() {
  local name="$1"
  shift
  echo "----------------------------------------"
  echo "[$name]"
  "$@" 2>&1 | sed -n '1,25p'
  echo ""
}

echo "=== CORS + Features Fix Verification ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Fix 1 — R2 bucket CORS (signed URL + public CDN)
probe "R2-signed-origin-403-check" curl -sSI -H "Origin: $ORIGIN" \
  "$R2_BASE/digital-assets/singles/hour-glass/audio.mp3" || true

probe "R2-video-Range-206" curl -sSI -H "Origin: $ORIGIN" -H "Range: bytes=0-1023" \
  "$R2_BASE/videos/singles/hour-glass/hourglass.mp4"

probe "R2-OPTIONS-preflight" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range" \
  "$R2_BASE/videos/singles/hour-glass/hourglass.mp4"

# Fix 3 — feature preview entity folder (not flat legacy)
probe "API-feature-preview-entity-folder" curl -sSI -H "Origin: $ORIGIN" \
  "$SITE/api/media/preview?folder=previews/features/i-dont-believe-you/"

probe "API-feature-preview-legacy-flat" curl -sSI -H "Origin: $ORIGIN" \
  "$SITE/api/media/preview?folder=previews/features/i-dont-believe-you/&legacy=previews/i-dont-believe-you-preview.wav"

probe "API-media-preview-OPTIONS" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range" \
  "$SITE/api/media/preview?folder=previews/features/i-dont-believe-you/"

# Fix 2 — entitled stream (requires session cookie)
probe "API-library-stream-unauth" curl -sSI \
  "$SITE/api/library/stream?slug=i-dont-believe-you"

echo "Done. For entitled stream: log in, then:"
echo "  curl -sSI -b cookies.txt \"$SITE/api/library/stream?slug=i-dont-believe-you&redirect=1\""
