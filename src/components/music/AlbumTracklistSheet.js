"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { albumTracksForPlayback } from "@/lib/music-playback";
import { useAudioPlayer } from "@/context/AudioContext";
import CSModeButton from "@/components/audio/CSModeButton";
import CoverArt from "@/components/ui/CoverArt";

const formatDuration = (seconds) => {
  if (!seconds || !isFinite(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function AlbumTracklistSheet({
  open,
  album,
  accountState,
  userId,
  onClose,
}) {
  const { playQueue, toggle, currentTrack, isPlaying, hasStarted, setShuffle, seekBack, seekForward } = useAudioPlayer();
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStartY = useRef(null);
  const touchDeltaY = useRef(0);

  const tracks = useMemo(
    () => (album ? albumTracksForPlayback(album, { ...accountState, userId }, "album_tracklist") : []),
    [album, accountState, userId]
  );

  useEffect(() => {
    if (!open) {
      setSwipeOffset(0);
      touchStartY.current = null;
      touchDeltaY.current = 0;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
    touchDeltaY.current = 0;
    setSwipeOffset(0);
  }, []);

  const onTouchMove = useCallback((e) => {
    if (touchStartY.current == null) return;
    const delta = (e.touches[0]?.clientY ?? 0) - touchStartY.current;
    touchDeltaY.current = delta;
    if (delta > 0) setSwipeOffset(Math.min(delta, 120));
  }, []);

  const onTouchEnd = useCallback(() => {
    if (touchDeltaY.current > 80) onClose?.();
    else setSwipeOffset(0);
    touchStartY.current = null;
    touchDeltaY.current = 0;
  }, [onClose]);

  const playAndClose = useCallback(
    (startIndex, shuffle = false) => {
      if (!tracks.length) return;
      if (shuffle) {
        setShuffle(true);
        const order = [...tracks].sort(() => Math.random() - 0.5);
        void playQueue(order, 0);
      } else {
        setShuffle(false);
        void playQueue(tracks, startIndex);
      }
      onClose?.();
    },
    [tracks, playQueue, setShuffle, onClose]
  );

  const isTrackActive = useCallback(
    (track, index) => {
      if (!hasStarted || !currentTrack) return false;
      const sameId =
        currentTrack.id === track.id ||
        currentTrack.slug === track.slug ||
        (currentTrack.metadata?.trackIndex === index && currentTrack.metadata?.albumSlug === album?.slug);
      return sameId;
    },
    [album?.slug, currentTrack, hasStarted]
  );

  if (!open || !album) return null;

  const trackCount = tracks.length || album.tracks?.length || album.trackTitles?.length || 0;
  const albumCoverType = album.coverArtType || "image";

  return (
    <div
      role="dialog"
      aria-label={`${album.title} tracklist`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "70vh",
          background: "#0d0d0d",
          border: "1px solid #222",
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          transform: swipeOffset ? `translateY(${swipeOffset}px)` : undefined,
          transition: swipeOffset === 0 ? "transform 0.22s ease-out" : "none",
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,0.28)",
            margin: "10px auto 0",
            flexShrink: 0,
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px 10px",
            flexShrink: 0,
            borderBottom: "1px solid #1a1a1a",
          }}
        >
          <CoverArt
            src={album.cover}
            type={albumCoverType}
            alt=""
            width={56}
            height={56}
            borderRadius={8}
            style={{ flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {album.title}
            </div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{trackCount} tracks</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => playAndClose(0, false)}
            disabled={!tracks.length}
            style={{
              flex: 1,
              height: 40,
              background: "#00ffff",
              color: "#000",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 800,
              cursor: tracks.length ? "pointer" : "not-allowed",
              opacity: tracks.length ? 1 : 0.4,
            }}
          >
            Play All
          </button>
          <button
            type="button"
            onClick={() => playAndClose(0, true)}
            disabled={!tracks.length}
            style={{
              flex: 1,
              height: 40,
              background: "#111",
              color: "#00ffff",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: tracks.length ? "pointer" : "not-allowed",
              opacity: tracks.length ? 1 : 0.4,
            }}
          >
            Shuffle
          </button>
          <CSModeButton />
        </div>

        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "0 8px" }}>
          {(tracks.length ? tracks : (album.tracks || []).map((t, i) => ({
            id: `${album.slug}-${i}`,
            title: typeof t === "string" ? t : t?.title || `Track ${i + 1}`,
            metadata: { durationSeconds: null },
          }))).map((track, index) => {
            const active = isTrackActive(track, index);
            const duration =
              track.metadata?.durationSeconds ||
              track.durationSeconds ||
              track.duration ||
              null;
            const trackCover = track.cover || album.cover;
            const trackCoverType = track.coverArtType || albumCoverType;
            return (
              <div
                key={track.id || index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 8px",
                  borderBottom: "1px solid #141414",
                  background: active ? "#0d0d0d" : "transparent",
                }}
              >
                <span style={{ width: 22, fontSize: 11, color: "#555", textAlign: "right", flexShrink: 0 }}>
                  {index + 1}
                </span>
                {trackCover && (
                  <CoverArt
                    src={trackCover}
                    type={trackCoverType}
                    alt=""
                    width={32}
                    height={32}
                    borderRadius={6}
                    style={{ flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: active ? 700 : 500,
                      color: active ? "#00ffff" : "#eee",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {track.title}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "#555", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {formatDuration(duration) || "—"}
                </span>
                {active && (
                  <>
                    <button
                      type="button"
                      aria-label="Rewind 15 seconds"
                      onClick={() => seekBack(15)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#666",
                        cursor: "pointer",
                        fontSize: 28,
                        lineHeight: 1,
                        padding: 0,
                        width: 28,
                        height: 28,
                        flexShrink: 0,
                      }}
                    >
                      ⏪
                    </button>
                    <button
                      type="button"
                      aria-label="Forward 15 seconds"
                      onClick={() => seekForward(15)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#666",
                        cursor: "pointer",
                        fontSize: 28,
                        lineHeight: 1,
                        padding: 0,
                        width: 28,
                        height: 28,
                        flexShrink: 0,
                      }}
                    >
                      ⏩
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-label={active && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                  onClick={() => {
                    if (active && isPlaying) {
                      void toggle();
                      onClose?.();
                      return;
                    }
                    if (active) {
                      void toggle();
                      onClose?.();
                      return;
                    }
                    playAndClose(index, false);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    border: "1px solid #333",
                    background: "#111",
                    color: "#00ffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                    padding: 0,
                    fontSize: 12,
                  }}
                >
                  {active && isPlaying ? (
                    <span style={{ fontSize: 11 }}>⏸</span>
                  ) : (
                    <span style={{ marginLeft: 2 }}>▶</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", flexShrink: 0 }} />
      </div>
    </div>
  );
}
