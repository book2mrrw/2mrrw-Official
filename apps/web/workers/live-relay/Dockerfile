FROM bluenviron/mediamtx:1.20.1-ffmpeg

COPY mediamtx.yml /mediamtx.yml
COPY relay-to-twitch.sh /relay-to-twitch.sh

RUN apk add --no-cache curl jq \
    && chmod 0444 /mediamtx.yml \
    && chmod 0555 /relay-to-twitch.sh

USER 65532:65532
ENTRYPOINT ["/mediamtx"]
CMD ["/mediamtx.yml"]
