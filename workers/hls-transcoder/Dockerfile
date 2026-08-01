FROM node:20-slim

# Install FFmpeg from Debian repos — system binary, no bundled wrappers.
# ffmpeg-7.x ships in Debian bookworm (Node 20 slim is bookworm-based).
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

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
