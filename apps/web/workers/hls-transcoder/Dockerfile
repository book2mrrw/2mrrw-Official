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
# SOURCE URL CHANGED 2026-09-30 — the previous pin BROKE THE BUILD ENTIRELY.
#
# This previously pinned autobuild-2026-09-06-13-06. BtbN's autobuild releases are
# rotated and DELETED — the GitHub releases API now lists autobuilds no further back
# than 14 days — so that tag 404'd and every image build failed at this layer, for all
# three lanes, not just the newest one. The running machines survived only because they
# still hold the old image; nothing could be rebuilt or redeployed.
#
# So an exact autobuild tag is not actually a durable pin: it is a pin with a ~2-week
# shelf life. The `latest` release's per-branch assets are the stable-URL alternative —
# `ffmpeg-n9.0-latest-...` stays on the SAME 9.0 release branch this already tracked
# (was n9.0.1-26, now n9.0.2-17), so it takes 9.0.x bugfixes and never a major jump.
#
# The sha256 is still verified, so this is not a floating unverified pull. The trade is
# deliberate: BtbN rebuilds that asset in place, and when they do this layer fails LOUDLY
# with a checksum mismatch that names its own fix (recompute and update the ARG below)
# rather than 404ing on a tag that no longer exists anywhere. Fail-closed either way; the
# difference is that this failure is self-describing and the old one required research.
#
# Verified for this exact tarball, same method as the original (downloaded and inspected,
# not assumed): `strings <binary> | grep -- --enable` reports --enable-libplacebo,
# --enable-vulkan, --enable-libzimg, --enable-libsvtav1, --enable-libx264,
# --enable-libx265, --enable-libaom, --enable-libdav1d and --enable-libvmaf — every
# library above is still present. Reported version: n9.0.2-17-g2a571b6068-20260930.
#
# PERMANENT FIX, not yet done: mirror this tarball into R2 (already owned) and point this
# ARG at that immutable object. That removes the dependency on anyone else's retention
# policy, which is the actual root cause of this outage.
#
# NOT YET CONFIRMED LIVE: the binary's enabled libraries are verified above, but the
# actual libplacebo tone-map invocation in hdr-tonemap.js has not been run against a real
# machine yet (no Docker/Linux runtime was available to do that from where this was
# written) — see that file's header before trusting this in production.
FROM debian:bookworm-slim AS ffmpeg-stage
RUN apt-get update && apt-get install -y --no-install-recommends curl xz-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ARG FFMPEG_BUILD_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz
ARG FFMPEG_BUILD_SHA256=943ae354eb18a6fad05119786c1ad4a44025954ad5f400f2794ac960afe4c2e0
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
