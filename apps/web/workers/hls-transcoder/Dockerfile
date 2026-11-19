# HLS transcoder image: the audio, video, vault-video and track-visual lanes.
#
# History: until 2026-11-18 this image downloaded BtbN/FFmpeg-Builds' static
# amd64 build (first mwader/static-ffmpeg, which lacked libplacebo). That
# rationale — FFmpeg 6+ for encrypted fMP4, libplacebo + Vulkan for HDR->SDR —
# still holds and is met below from sources that cannot rotate or disappear.

ARG DEBIAN_SNAPSHOT=20261118T000000Z

# ── Stage 1: FFmpeg from permanent sources, for amd64 and arm64 alike ──────────
# The official FFmpeg 9.0.2 release tarball (ffmpeg.org keeps every release;
# its signature was verified against the FFmpeg release signing key,
# FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8, when this pin was made),
# built against Debian 13 libraries from one permanent snapshot, plus two
# libraries Debian 13 cannot supply, each built from a pinned source:
#   - Netflix's libvmaf 3.0.0 (not packaged; its tagged source, SHA-256
#     pinned, linked statically);
#   - libplacebo 7.360.1 (Debian 13 ships 7.349, FFmpeg 9.0 needs >= 7.351):
#     the upstream release exactly as Debian archived it for its own package,
#     fetched from snapshot.debian.org and checked against the SHA-256 in
#     Debian's signed libplacebo_7.360.1-1.dsc; a shared library that the
#     runtime stage carries next to FFmpeg.
# This replaces BtbN's rotating amd64-only "latest" download: its dated builds
# are deleted within ~14 days (which broke every lane's build once), its
# "latest" asset changes under the pinned checksum, and it could never run on
# an arm64 host. Same FFmpeg release as before (9.0.2), same features: x264,
# x265, SVT-AV1, dav1d, libvmaf (with cambi), zimg (zscale), libplacebo +
# Vulkan, OpenCL.
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS ffmpeg-build
ARG DEBIAN_SNAPSHOT
ARG FFMPEG_VERSION=9.0.2
ARG FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
ARG VMAF_VERSION=3.0.0
ARG VMAF_SHA256=7178c4833639e6b989ecae73131d02f70735fdb3fc2c7d84bc36c9c3461d93b1
ARG PLACEBO_VERSION=7.360.1
ARG PLACEBO_ARCHIVED=20260319T023008Z
ARG PLACEBO_SHA256=3e697b2831fe75acbe096ac85114c3b425c25bbbac427b03a923ac0f4db27e79
# The Vulkan headers libplacebo 7.360.1 pins as its 3rdparty/Vulkan-Headers
# submodule (commit 450bd22 = Khronos tag v1.4.337); Debian 13's 1.4.309 lacks
# extensions it uses. Used for building libplacebo only.
ARG VULKAN_HEADERS_VERSION=1.4.337
ARG VULKAN_HEADERS_SHA256=13845b9dc873758cdc1f2be6219f7fc99afea0a2c80586043b5bb435b99e590b
COPY debian-snapshot.sh /usr/local/bin/debian-snapshot
RUN sh /usr/local/bin/debian-snapshot "$DEBIAN_SNAPSHOT" \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config nasm meson ninja-build xxd curl ca-certificates xz-utils \
      libx264-dev libx265-dev libsvtav1enc-dev libdav1d-dev libzimg-dev \
      libvulkan-dev ocl-icd-opencl-dev opencl-headers \
      python3-jinja2 libshaderc-dev liblcms2-dev libxxhash-dev libfast-float-dev \
      zlib1g-dev libbz2-dev liblzma-dev
# libplacebo for Vulkan tone-mapping (track visuals' HDR -> SDR): shaderc
# compiles its shaders, lcms2 does colour management; no OpenGL/D3D11 (FFmpeg
# drives it through Vulkan only).
RUN curl -fsSL "https://snapshot.debian.org/archive/debian/${PLACEBO_ARCHIVED}/pool/main/libp/libplacebo/libplacebo_${PLACEBO_VERSION}.orig.tar.gz" -o /tmp/placebo.tar.gz \
 && echo "${PLACEBO_SHA256}  /tmp/placebo.tar.gz" | sha256sum -c - \
 && curl -fsSL "https://github.com/KhronosGroup/Vulkan-Headers/archive/refs/tags/v${VULKAN_HEADERS_VERSION}.tar.gz" -o /tmp/vulkan-headers.tar.gz \
 && echo "${VULKAN_HEADERS_SHA256}  /tmp/vulkan-headers.tar.gz" | sha256sum -c - \
 && mkdir /tmp/placebo && tar -xzf /tmp/placebo.tar.gz -C /tmp/placebo --strip-components=1 \
 && tar -xzf /tmp/vulkan-headers.tar.gz -C /tmp/placebo/3rdparty/Vulkan-Headers --strip-components=1 \
 && meson setup /tmp/placebo/build /tmp/placebo --buildtype=release --prefix=/usr/local --libdir=lib \
      -Dvulkan=enabled -Dvk-proc-addr=enabled \
      -Dshaderc=enabled -Dglslang=disabled -Dlcms=enabled -Dxxhash=enabled -Ddovi=enabled -Dlibdovi=disabled \
      -Dopengl=disabled -Dd3d11=disabled -Dunwind=disabled \
      -Ddemos=false -Dtests=false -Dbench=false -Dfuzz=false \
 && ninja -C /tmp/placebo/build install && ldconfig \
 && pkg-config --atleast-version="${PLACEBO_VERSION}" libplacebo
# libvmaf with its built-in models (no model files at runtime) and float
# features (float_ssim), which the quality evaluator measures with cambi.
RUN curl -fsSL "https://github.com/Netflix/vmaf/archive/refs/tags/v${VMAF_VERSION}.tar.gz" -o /tmp/vmaf.tar.gz \
 && echo "${VMAF_SHA256}  /tmp/vmaf.tar.gz" | sha256sum -c - \
 && mkdir /tmp/vmaf && tar -xzf /tmp/vmaf.tar.gz -C /tmp/vmaf --strip-components=1 \
 && meson setup /tmp/vmaf/build /tmp/vmaf/libvmaf --buildtype=release --prefix=/opt/vmaf --libdir=lib \
      -Ddefault_library=static -Dbuilt_in_models=true -Denable_float=true -Denable_tests=false -Denable_docs=false \
 && ninja -C /tmp/vmaf/build install
RUN curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o /tmp/ffmpeg.tar.xz \
 && echo "${FFMPEG_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
 && mkdir /tmp/ffmpeg && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1 \
 && cd /tmp/ffmpeg \
 && PKG_CONFIG_PATH=/opt/vmaf/lib/pkgconfig:/usr/local/lib/pkgconfig ./configure --prefix=/opt/ffmpeg --disable-debug --disable-doc --disable-ffplay \
      --extra-libs="-lstdc++ -lpthread -lm" \
      --enable-gpl --enable-version3 \
      --enable-libx264 --enable-libx265 --enable-libsvtav1 --enable-libdav1d \
      --enable-libvmaf --enable-libzimg \
      --enable-vulkan --enable-libplacebo --enable-opencl \
 && make -j"$(nproc)" && make install \
 && for f in libvmaf libplacebo zscale; do /opt/ffmpeg/bin/ffmpeg -hide_banner -filters | grep -qw "$f" || exit 1; done \
 && for e in libx264 libx265 libsvtav1 mjpeg png; do /opt/ffmpeg/bin/ffmpeg -hide_banner -encoders | grep -qw "$e" || exit 1; done \
 && ldd /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe | awk '/=> \//{print $3}' | xargs -r readlink -f | sort -u \
    | xargs -r dpkg -S 2>/dev/null | cut -d: -f1 | sort -u > /opt/ffmpeg/runtime-packages

# ── Stage 2: the worker ────────────────────────────────────────────────────────
FROM node:22-trixie-slim@sha256:68c76cfad89921b927eae28ba21407475e29d0ce450afcdbe70c1532db042b64
ARG DEBIAN_SNAPSHOT
COPY debian-snapshot.sh /usr/local/bin/debian-snapshot
COPY --from=ffmpeg-build /opt/ffmpeg/runtime-packages /tmp/runtime-packages

# FFmpeg's shared libraries (exactly the packages it links against, from the
# same snapshot), plus software Vulkan (Mesa lavapipe) for libplacebo
# tone-mapping — these hosts have no GPU. libvulkan1 is the loader FFmpeg
# dlopens at runtime and mesa-vulkan-drivers supplies the lavapipe ICD, found
# through the default /usr/share/vulkan/icd.d path; slower than a GPU, no driver.
RUN sh /usr/local/bin/debian-snapshot "$DEBIAN_SNAPSHOT" \
 && apt-get install -y --no-install-recommends $(cat /tmp/runtime-packages) libvulkan1 mesa-vulkan-drivers ocl-icd-libopencl1 \
 && rm -rf /var/lib/apt/lists/* /tmp/runtime-packages

COPY --from=ffmpeg-build /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-build /opt/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=ffmpeg-build /usr/local/lib/libplacebo.so.* /usr/local/lib/
RUN ldconfig \
 && ffmpeg -hide_banner -version | head -1 > /etc/ffmpeg-version \
 && for f in libvmaf libplacebo zscale; do ffmpeg -hide_banner -filters | grep -qw "$f" || exit 1; done

WORKDIR /app

# Install Node deps first (Docker layer cache), exactly as locked
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy source, and Supabase's root certificate: the video lanes verify their
# database connection against it (src/lane-db.js)
COPY src/ ./src/
COPY certs/ ./certs/

# Non-root for security — dropped at the application layer (src/drop-privileges.js)
# instead of via USER here, so the video lane can chown its freshly-mounted
# /data volume (owned by root on first attach) before dropping to this user.
RUN useradd -r -u 1001 worker && chown -R worker /app

CMD ["node", "src/workers/audio-worker.js"]
