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

source="rtsp://127.0.0.1:${RTSP_PORT:-8554}/${MTX_PATH}"

# H.264 from the studio goes to Twitch as it arrives: MediaMTX asks the
# browser for a keyframe every 2 seconds (Twitch's interval), so only the
# audio (Opus -> AAC) is converted and the relay needs almost no CPU. Anything
# else (a browser without H.264) is re-encoded as before.
video_codec="$(ffprobe -v error -rtsp_transport tcp -select_streams v:0 \
  -show_entries stream=codec_name -of csv=p=0 "$source" 2>/dev/null || true)"
if [ "$video_codec" = "h264" ]; then
  set -- -c:v copy
else
  set -- -c:v libx264 -preset veryfast -tune zerolatency -profile:v high -level:v 4.1 \
    -pix_fmt yuv420p -r 30 -g 60 -keyint_min 60 -sc_threshold 0 \
    -b:v "$video_bitrate" -maxrate "$video_bitrate" -bufsize 9000k
fi

# MediaMTX owns this process and sends SIGINT the moment the browser publisher
# disappears. Quiet FFmpeg logging prevents the secret-bearing output URL from
# ever being written to logs.
exec ffmpeg \
  -hide_banner \
  -loglevel quiet \
  -nostats \
  -rtsp_transport tcp \
  -i "$source" \
  -map 0:v:0 \
  -map 0:a:0 \
  "$@" \
  -c:a aac \
  -b:a 160k \
  -ar 48000 \
  -ac 2 \
  -flvflags no_duration_filesize \
  -f flv \
  "$destination"
