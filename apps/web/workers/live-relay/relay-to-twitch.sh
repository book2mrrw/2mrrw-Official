#!/bin/sh
set -eu

if [ -z "${LIVE_RELAY_SERVICE_SECRET:-}" ]; then
  exit 78
fi

video_bitrate="${TWITCH_VIDEO_BITRATE:-4500k}"
platform_origin="${LIVE_PLATFORM_ORIGIN:-https://www.2mrrw.com}"

# Ask the platform for a one-use-in-process destination only when a publisher
# appears. The OAuth access token, refresh token, and stream key remain on the
# server side and are never configured as Fly secrets or returned to a browser.
destination="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --retry 3 \
    --retry-all-errors \
    --connect-timeout 5 \
    --max-time 15 \
    --request POST \
    --header "Authorization: Bearer ${LIVE_RELAY_SERVICE_SECRET}" \
    "${platform_origin}/api/live/twitch-ingest" \
  | jq -er '.destination | select(type == "string" and startswith("rtmps://ingest.global-contribute.live-video.net/app/"))'
)"

# MediaMTX owns this process and sends SIGINT the moment the browser publisher
# disappears. Quiet FFmpeg logging prevents the secret-bearing output URL from
# ever being written to Fly logs.
exec ffmpeg \
  -hide_banner \
  -loglevel quiet \
  -nostats \
  -rtsp_transport tcp \
  -i "rtsp://127.0.0.1:${RTSP_PORT:-8554}/${MTX_PATH}" \
  -map 0:v:0 \
  -map 0:a:0 \
  -c:v libx264 \
  -preset veryfast \
  -tune zerolatency \
  -profile:v high \
  -level:v 4.1 \
  -pix_fmt yuv420p \
  -r 30 \
  -g 60 \
  -keyint_min 60 \
  -sc_threshold 0 \
  -b:v "$video_bitrate" \
  -maxrate "$video_bitrate" \
  -bufsize 9000k \
  -c:a aac \
  -b:a 160k \
  -ar 48000 \
  -ac 2 \
  -flvflags no_duration_filesize \
  -f flv \
  "$destination"
