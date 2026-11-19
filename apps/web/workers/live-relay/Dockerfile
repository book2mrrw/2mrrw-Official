# Multi-architecture (amd64/arm64) index, pinned: the same bits on Fly or any owned host.
FROM bluenviron/mediamtx:1.20.1-ffmpeg@sha256:16c56911dbd1fd7a85455042fa8320779fc8bf6575c6903f74023b202c1a620c

COPY mediamtx.yml /mediamtx.yml
COPY relay-to-twitch.sh /relay-to-twitch.sh

RUN apk add --no-cache curl jq \
    && chmod 0444 /mediamtx.yml \
    && chmod 0555 /relay-to-twitch.sh

USER 65532:65532
ENTRYPOINT ["/mediamtx"]
CMD ["/mediamtx.yml"]
