# Stage 1: pull the static FFmpeg 7.x binary (encrypted fMP4 requires FFmpeg 6+; Debian bookworm only ships 5.1)
FROM mwader/static-ffmpeg:7.1 AS ffmpeg-stage

# Stage 2: runtime
FROM node:22-slim

COPY --from=ffmpeg-stage /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-stage /ffprobe /usr/local/bin/ffprobe

WORKDIR /app

# Install Node deps first (Docker layer cache)
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy source
COPY src/ ./src/

# Non-root for security — dropped at the application layer (src/drop-privileges.js)
# instead of via USER here, so the video lane can chown its freshly-mounted
# /data volume (owned by root on first attach) before dropping to this user.
RUN useradd -r -u 1001 worker && chown -R worker /app

CMD ["node", "src/workers/audio-worker.js"]
