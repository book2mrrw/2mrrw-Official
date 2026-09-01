# Stage 1: pull the static FFmpeg 7.x binary (encrypted fMP4 requires FFmpeg 6+; Debian bookworm only ships 5.1)
FROM mwader/static-ffmpeg:7.1 AS ffmpeg-stage

# Stage 2: runtime
FROM node:22-slim

COPY --from=ffmpeg-stage /ffmpeg /usr/local/bin/ffmpeg

WORKDIR /app

# Install Node deps first (Docker layer cache)
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy source
COPY src/ ./src/

# Non-root for security
RUN useradd -r -u 1001 worker && chown -R worker /app
USER worker

CMD ["node", "src/index.js"]
