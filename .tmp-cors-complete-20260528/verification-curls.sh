#!/usr/bin/env bash
# Complete CORS verification — R2 public CDN + /api/media/* + /api/library/*
set -euo pipefail

R2_BASE="${R2_BASE:-https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev}"
SITE="${SITE:-https://www.2mrrw.com}"
ORIGIN="${ORIGIN:-https://www.2mrrw.com}"

probe() {
  local name="$1"
  shift
  echo "----------------------------------------"
  echo "[$name]"
  "$@" 2>&1 | sed -n '1,30p'
  echo ""
}

echo "=== R2 CORS Complete Verification ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "R2_BASE: $R2_BASE"
echo "SITE: $SITE"
echo ""

VIDEO="videos/singles/hour-glass/hourglass.mp4"
PREVIEW="previews/singles/hour-glass/hourglass-preview.mp3"

for folder in videos previews images digital-assets; do
  case "$folder" in
    videos) path="$VIDEO" ;;
    previews) path="$PREVIEW" ;;
    images) path="images/singles/hour-glass/cover.jpg" ;;
    digital-assets) path="digital-assets/singles/hour-glass/audio.wav" ;;
  esac
  probe "R2-GET-$folder" curl -sSI -H "Origin: $ORIGIN" "$R2_BASE/$path"
done

probe "R2-video-Range-206" curl -sSI -H "Origin: $ORIGIN" -H "Range: bytes=0-1023" "$R2_BASE/$VIDEO"
probe "R2-OPTIONS-preflight" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range, Authorization" \
  "$R2_BASE/$VIDEO"
probe "R2-Origin-apex" curl -sSI -H "Origin: https://2mrrw.com" "$R2_BASE/$VIDEO"
probe "R2-Origin-localhost" curl -sSI -H "Origin: http://localhost:3000" "$R2_BASE/$VIDEO"

probe "API-media-preview-OPTIONS" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range" \
  "$SITE/api/media/preview?folder=previews/singles/hour-glass/"
probe "API-media-preview-GET" curl -sSI -H "Origin: $ORIGIN" \
  "$SITE/api/media/preview?folder=previews/singles/hour-glass/"

for rt in single feature album mixtapes-and-eps; do
  case "$rt" in
    single) slug=hour-glass ;;
    feature) slug=i-dont-believe-you ;;
    album) slug=frame-of-mind ;;
    mixtapes-and-eps) slug=2mrrw-tape-vol-1 ;;
  esac
  probe "API-media-visual-$rt" curl -sSI -H "Origin: $ORIGIN" \
    "$SITE/api/media/visual?releaseType=$rt&slug=$slug&meta=1"
done

probe "API-library-stream-OPTIONS" curl -sSI -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range, Authorization" \
  "$SITE/api/library/stream?slug=hour-glass"
probe "API-library-stream-GET" curl -sSI -H "Origin: $ORIGIN" \
  "$SITE/api/library/stream?slug=hour-glass"
