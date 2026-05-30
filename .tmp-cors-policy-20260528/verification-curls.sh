#!/usr/bin/env bash
# Repeatable CORS verification for 2mrrw-media (R2 public CDN + /api/media/*).
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

echo "=== R2 CORS Verification Probes ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "R2_BASE: $R2_BASE"
echo "SITE: $SITE"
echo ""

VIDEO="videos/singles/hour-glass/hourglass.mp4"
PREVIEW="audio/singles/hour-glass/hourglass-preview.mp3"

probe "R2-video-GET-Origin" curl -sSI -H "Origin: $ORIGIN" "$R2_BASE/$VIDEO"
probe "R2-video-Range-206" curl -sSI -H "Origin: $ORIGIN" -H "Range: bytes=0-1023" "$R2_BASE/$VIDEO"
probe "R2-OPTIONS-preflight" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range" \
  "$R2_BASE/$VIDEO"
probe "R2-Origin-apex" curl -sSI -H "Origin: https://2mrrw.com" "$R2_BASE/$VIDEO"
probe "R2-Origin-localhost" curl -sSI -H "Origin: http://localhost:3000" "$R2_BASE/$VIDEO"
probe "R2-preview-GET" curl -sSI -H "Origin: $ORIGIN" "$R2_BASE/$PREVIEW"
probe "R2-legacy-host-401" curl -sSI -H "Origin: $ORIGIN" \
  "https://pub-992d4f5d45e7c56189a518c2f417fe25.r2.dev/$PREVIEW"

probe "API-media-preview-OPTIONS" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range" \
  "$SITE/api/media/preview?folder=audio/singles/hour-glass/&legacy=audio/singles/hour-glass/hourglass-preview.mp3"

probe "API-media-preview-GET" curl -sSI -H "Origin: $ORIGIN" \
  "$SITE/api/media/preview?folder=audio/singles/hour-glass/&legacy=audio/singles/hour-glass/hourglass-preview.mp3"

probe "API-media-visual-OPTIONS" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  "$SITE/api/media/visual?releaseType=single&slug=hour-glass&meta=1"

probe "API-media-visual-GET-meta" curl -sSI -H "Origin: $ORIGIN" \
  "$SITE/api/media/visual?releaseType=single&slug=hour-glass&meta=1"

probe "API-media-playback-OPTIONS" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  "$SITE/api/media/playback"
