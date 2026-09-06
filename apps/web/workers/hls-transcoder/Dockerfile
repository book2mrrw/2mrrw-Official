# Stage 1: fetch a static FFmpeg build with libplacebo + Vulkan (encrypted fMP4 requires
# FFmpeg 6+; Debian bookworm only ships 5.1 — same reason as before). Switched from
# mwader/static-ffmpeg to BtbN/FFmpeg-Builds' linux64-gpl release because mwader's image
# does not build libplacebo at all (confirmed against its own README — listed only under
# "possible things to add", never shipped). libplacebo is what makes hdr-tonemap.js's
# HDR->SDR path work without depending on zscale's linear-transfer conversion, which was
# confirmed broken on the old image (see hdr-tonemap.js's header for that history).
#
# Confirmed for real by downloading this exact release asset and inspecting the actual
# binary (not assumed from BtbN's docs): `objdump -p` shows it dynamically needs only
# glibc/libgcc at link time (no libvulkan.so.1 NEEDED entry — Vulkan is dlopen'd at
# runtime, hence the runtime packages below), and `strings <binary> | grep -- --enable`
# on its embedded configure string shows `--enable-libplacebo --enable-vulkan
# --enable-libzimg --enable-libsvtav1 --enable-libx264 --enable-libx265 --enable-libaom
# --enable-libdav1d --enable-libvmaf` — every codec this worker already depends on is
# still present, plus libplacebo/Vulkan.
#
# Pinned by exact release tag + a sha256 computed from the actual downloaded file (BtbN
# publishes no checksum of its own), not a floating "latest" tag — matching how this
# Dockerfile already pins its other versions.
#
# NOT YET CONFIRMED LIVE: the binary's enabled libraries are verified above, but the
# actual libplacebo tone-map invocation in hdr-tonemap.js has not been run against a real
# machine yet (no Docker/Linux runtime was available to do that from where this was
# written) — see that file's header before trusting this in production.
FROM debian:bookworm-slim AS ffmpeg-stage
RUN apt-get update && apt-get install -y --no-install-recommends curl xz-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ARG FFMPEG_BUILD_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-06-13-06/ffmpeg-n9.0.1-26-g5c8e7e2433-linux64-gpl-9.0.tar.xz
ARG FFMPEG_BUILD_SHA256=e60c4187c792cc35d2558adbae5582c470713f5afed7212999200340f1394f8d
RUN curl -fsSL "$FFMPEG_BUILD_URL" -o /tmp/ffmpeg.tar.xz \
  && echo "$FFMPEG_BUILD_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
  && mkdir /tmp/ffmpeg-extract \
  && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extract --strip-components=1 \
  && mv /tmp/ffmpeg-extract/bin/ffmpeg /ffmpeg \
  && mv /tmp/ffmpeg-extract/bin/ffprobe /ffprobe

# Stage 2: runtime
FROM node:22-slim

# Software Vulkan (Mesa lavapipe) for libplacebo tone-mapping — these Fly machines have
# no GPU. libvulkan1 is the Khronos loader the ffmpeg binary dlopens at runtime (it is
# NOT a link-time dependency, confirmed via objdump above, so it must be installed as a
# system package); mesa-vulkan-drivers supplies the lavapipe software ICD, which the
# loader finds automatically via the default /usr/share/vulkan/icd.d search path — no
# GPU or real driver needed, just slower than real hardware would be.
RUN apt-get update && apt-get install -y --no-install-recommends libvulkan1 mesa-vulkan-drivers \
  && rm -rf /var/lib/apt/lists/*

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
