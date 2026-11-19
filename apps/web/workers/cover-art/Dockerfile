# Cover art lane (2MRRW-Cloud). One image for every host: the Lima VM on the
# Mac today, the owned primary/backup servers later (amd64 or arm64; the base
# digest is a multi-architecture index). Silent H.264/MP4 renditions need
# nothing beyond Debian's packaged FFmpeg; the resolved FFmpeg version is
# recorded in the image so a rebuilt image can be compared with a running one.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -version | head -1 > /etc/cover-art-ffmpeg-version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
# Supabase's root certificate: the database connection is TLS-verified against it.
COPY certs ./certs

# Unprivileged; writes only to its scratch directory (compose mounts /scratch).
USER node
ENV COVER_ART_SCRATCH=/scratch NODE_ENV=production
CMD ["node", "src/worker.js"]
