"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate, useDragControls } from "framer-motion";
import {
  albumTracksForPlayback,
  getPlayButtonState,
  isSamePlaybackTrack,
  playableReleaseQueue,
  resolveReleaseQueueStartIndex,
  toInstantStartTrack,
} from "@/lib/music-playback";
import { resolveTrackAccess } from "@/lib/music-access";
import { useAudioPlayer } from "@/context/AudioContext";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import CSModeButton from "@/components/audio/CSModeButton";
import CoverArt from "@/components/ui/CoverArt";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";
import { ModalErrorBoundary } from "@/system/errors";
import { isPlaybackTraceEnabled, logPlaybackEvent } from "@/lib/diagnostics/playback-trace";

const formatDuration = (seconds) => {
  if (!seconds || !isFinite(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const sheetSpring = { type: "spring", stiffness: 420, damping: 36, mass: 0.85 };

export default function AlbumTracklistSheet({
  open,
  album,
  catalogPlaybackLookup,
  accountState,
  userId,
  isAdmin = false,
  isMobile = false,
  onClose,
  onLibraryChange,
}) {
  const {
    dispatchPlaybackCommand,
    toggle,
    currentTrack,
    isPlaying,
    hasStarted,
    setShuffle,
    seekBack,
    seekForward,
    error,
    hintUpcomingPlay,
  } = useAudioPlayer();
  const dragY = useMotionValue(0);
  const sheetOpacity = useTransform(dragY, [0, 120], [1, 0.55]);
  const dismissTriggered = useRef(false);
  const dragControls = useDragControls();
  const autoPlayedRef = useRef(false);

  const tracks = useMemo(
    () =>
      album
        ? albumTracksForPlayback(
            album,
            { ...accountState, userId, isAdmin },
            "album_tracklist",
            catalogPlaybackLookup
          )
        : [],
    [album, accountState, catalogPlaybackLookup, userId, isAdmin]
  );

  // Plays a specific track without closing the sheet — user can change tracks at will.
  const playTrackInSheet = useCallback(
    (releaseTrackIndex) => {
      const playable = playableReleaseQueue(tracks, { ...accountState, userId, isAdmin });
      if (!playable.length) return;
      setShuffle(false);
      const sourceTrack = tracks[releaseTrackIndex];
      const queueIndex = resolveReleaseQueueStartIndex(playable, releaseTrackIndex, sourceTrack);
      const queueTrack = playable[queueIndex];
      if (!queueTrack) return;
      const { startTrack } = toInstantStartTrack(queueTrack);
      const instantQueue = playable.map((t, i) => (i === queueIndex ? startTrack : t));
      if (isPlaybackTraceEnabled()) {
        logPlaybackEvent({
          type: "tracklist:play-requested",
          source: "AlbumTracklistSheet.playTrackInSheet",
          trackId: instantQueue[queueIndex]?.slug,
          extra: {
            releaseTrackIndex,
            queueIndex,
            queueLength: instantQueue.length,
            queueSlugs: instantQueue.map((t) => t.slug),
            albumSlug: album?.slug,
          },
        });
      }
      void dispatchPlaybackCommand("playQueue", { tracks: instantQueue, startIndex: queueIndex, resumeAt: 0 });
    },
    [tracks, accountState, userId, isAdmin, dispatchPlaybackCommand, setShuffle, album]
  );

  const isTrackActive = useCallback(
    (track) => {
      if (!hasStarted || !currentTrack) return false;
      return isSamePlaybackTrack(currentTrack, track);
    },
    [currentTrack, hasStarted]
  );

  useEffect(() => {
    if (open) {
      dragY.set(0);
      dismissTriggered.current = false;
      autoPlayedRef.current = false;
    }
  }, [open, dragY]);

  useEffect(() => {
    if (!open) return undefined;
    registerModal("album-tracklist-sheet");
    return () => unregisterModal("album-tracklist-sheet");
  }, [open]);

  // Intent-signal preload: start buffering the first track the moment the sheet opens,
  // before the user presses play — giving the browser 1-3s of head start.
  // Mirrors Spotify's hover-to-buffer pattern. Skipped when already playing so
  // we never compete with the active track's bandwidth.
  useEffect(() => {
    if (!open || !tracks.length || isPlaying) return;
    const playable = playableReleaseQueue(tracks, { ...accountState, userId, isAdmin });
    if (!playable.length) return;
    const { startTrack } = toInstantStartTrack(playable[0]);
    if (startTrack?.src) void hintUpcomingPlay(startTrack);
  }, [open, tracks, accountState, userId, isAdmin, isPlaying, hintUpcomingPlay]);

  // Auto-play track 1 on first-ever open of this release.
  // Persistence: localStorage key "2mrrw_fp_{slug}" is set the moment auto-play fires.
  // Subsequent opens skip auto-play and open in browse mode — user picks the track.
  // autoPlayedRef guards against re-fire within the same modal session.
  // First-time plays are intentional context switches, so isPlaying is not a guard.
  useEffect(() => {
    if (!open || autoPlayedRef.current || !tracks.length || !album?.slug) return;
    const firstPlayKey = `2mrrw_fp_${album.slug}`;
    if (localStorage.getItem(firstPlayKey)) return;
    const hasPlayable = tracks.some((t) => Boolean(t.src));
    if (!hasPlayable) return;
    autoPlayedRef.current = true;
    localStorage.setItem(firstPlayKey, "1");
    playTrackInSheet(0);
  }, [open, tracks, playTrackInSheet, album?.slug]);

  // Play All / Shuffle close the sheet after queuing.
  const playAndClose = useCallback(
    (shuffle = false) => {
      const playable = playableReleaseQueue(tracks, { ...accountState, userId, isAdmin });
      if (!playable.length) return;
      if (shuffle) {
        setShuffle(true);
        const randomIdx = Math.floor(Math.random() * playable.length);
        const { startTrack } = toInstantStartTrack(playable[randomIdx]);
        const instantPlayable = playable.map((t, i) => (i === randomIdx ? startTrack : t));
        void dispatchPlaybackCommand("playQueue", { tracks: instantPlayable, startIndex: randomIdx, resumeAt: 0 });
      } else {
        setShuffle(false);
        const { startTrack } = toInstantStartTrack(playable[0]);
        void dispatchPlaybackCommand("playQueue", { tracks: [startTrack, ...playable.slice(1)], startIndex: 0, resumeAt: 0 });
      }
      onClose?.();
    },
    [tracks, accountState, userId, isAdmin, dispatchPlaybackCommand, setShuffle, onClose]
  );

  const handleDragEnd = useCallback(
    (_, info) => {
      if (info.offset.y > 80 || info.velocity.y > 400) {
        dismissTriggered.current = true;
        animate(dragY, 280, { duration: 0.22, ease: [0.4, 0, 0.2, 1] }).then(() => {
          onClose?.();
          dragY.set(0);
        });
      } else {
        animate(dragY, 0, sheetSpring);
      }
    },
    [dragY, onClose]
  );

  if (!open || !album) return null;
  const pendingAutoPlay = !hasStarted && !isPlaying;

  const trackCount = tracks.length || album.tracks?.length || album.trackTitles?.length || 0;
  const albumCoverType = album.coverArtType || "image";

  // Drive header from the live active track when it belongs to this album;
  // fall back to album-level data when nothing from this album is playing.
  const activeAlbumTrack = hasStarted ? tracks.find((t) => isTrackActive(t)) : null;
  const headerCover = activeAlbumTrack?.cover || album.cover;
  const headerTitle = activeAlbumTrack?.title || album.title;
  const headerCoverType = activeAlbumTrack?.coverArtType || albumCoverType;

  return (
    <ModalErrorBoundary stackId="album-tracklist-sheet" onClose={onClose}>
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
        overflow: "hidden",
        paddingLeft: "max(0px, env(safe-area-inset-left))",
        paddingRight: "max(0px, env(safe-area-inset-right))",
      }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 200 }}
        dragElastic={{ top: 0, bottom: 0.35 }}
        style={{
          y: dragY,
          opacity: sheetOpacity,
          width: "100%",
          maxWidth: isMobile ? "100%" : 480,
          touchAction: "pan-y",
          boxSizing: "border-box",
        }}
        onDragEnd={handleDragEnd}
      >
        <div
          style={{
            height: isMobile ? "calc(100dvh - env(safe-area-inset-top) - 8px)" : undefined,
            maxHeight: isMobile ? "none" : "70vh",
            background: "linear-gradient(165deg, rgba(20,20,24,0.96) 0%, rgba(8,8,12,0.98) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "16px 16px 0 0",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 -12px 40px rgba(0,0,0,0.5), 0 0 24px rgba(0,191,255,0.06)",
            overflow: "hidden",
            width: "100%",
          }}
        >
          <div
            onPointerDown={(e) => dragControls.start(e)}
            style={{
              padding: "10px 0 6px",
              cursor: "grab",
              touchAction: "none",
              display: "flex",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <div
              className="player-sheet-handle"
              style={{
                width: 40,
                height: 5,
                borderRadius: 3,
                background: "rgba(140,140,148,0.55)",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px 10px",
              flexShrink: 0,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <CoverArt
              src={headerCover}
              type={headerCoverType}
              alt=""
              width={56}
              height={56}
              borderRadius={8}
              style={{ flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="player-track-title"
                style={{
                  fontSize: 15,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {headerTitle}
              </div>
              <div className="player-track-meta" style={{ fontSize: 11, marginTop: 4, opacity: 0.45 }}>
                {trackCount} tracks
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => playAndClose(false)}
              disabled={!tracks.some((t) => t.src)}
              style={{
                flex: 1,
                height: 40,
                background: "#00ffff",
                color: "#000",
                border: "none",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 800,
                cursor: tracks.some((t) => t.src) ? "pointer" : "not-allowed",
                opacity: tracks.some((t) => t.src) ? 1 : 0.4,
              }}
            >
              Play All
            </button>
            <button
              type="button"
              onClick={() => playAndClose(true)}
              disabled={!tracks.some((t) => t.src)}
              style={{
                flex: 1,
                height: 40,
                background: "rgba(255,255,255,0.05)",
                color: "#00ffff",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: tracks.some((t) => t.src) ? "pointer" : "not-allowed",
                opacity: tracks.some((t) => t.src) ? 1 : 0.4,
              }}
            >
              Shuffle
            </button>
            <CSModeButton />
          </div>

          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehavior: "contain",
              flex: 1,
              minHeight: 0,
              padding: isMobile ? "0 4px" : "0 8px",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {(tracks.length ? tracks : (album.tracks || []).map((t, i) => ({
              id: `${album.slug}-${i}`,
              title: typeof t === "string" ? t : t?.title || `Track ${i + 1}`,
              metadata: { durationSeconds: null },
            }))).map((track, index) => {
              const active = isTrackActive(track) || (pendingAutoPlay && index === 0);
              const duration =
                track.metadata?.durationSeconds ||
                track.durationSeconds ||
                track.duration ||
                null;
              const trackCover = track.cover || album.cover;
              const trackCoverType = track.coverArtType || albumCoverType;
              const previewUnavailable = Boolean(track.metadata?.previewUnavailable);
              const rowPlayState = getPlayButtonState(track, { ...accountState, userId, isAdmin });
              const trackAccess = resolveTrackAccess(
                { ...track, slug: track.slug || album.slug, albumSlug: album.slug },
                { ...accountState, userId, isAdmin }
              );
              const plusTrack = {
                ...track,
                slug: track.slug || `${album.slug}-t${index + 1}`,
                artist: track.artist || album.artist || "2MRRW",
                albumSlug: album.slug,
              };
              return (
                <div
                  key={track.id || index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: isMobile ? 6 : 10,
                    padding: isMobile ? "10px 6px" : "10px 8px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: active ? "rgba(0,191,255,0.06)" : "transparent",
                    minWidth: 0,
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <span style={{ width: 22, fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "right", flexShrink: 0 }}>
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
                        color: active ? "#00ffff" : "rgba(255,255,255,0.88)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {track.title}
                    </div>
                  </div>
                  {!isMobile ? (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {formatDuration(duration) || "—"}
                    </span>
                  ) : null}
                  {active && !isMobile ? (
                    <>
                      <button
                        type="button"
                        aria-label="Rewind 15 seconds"
                        onClick={() => seekBack(15)}
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 8,
                          color: "rgba(255,255,255,0.55)",
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "4px 6px",
                          flexShrink: 0,
                        }}
                      >
                        -15
                      </button>
                      <button
                        type="button"
                        aria-label="Forward 15 seconds"
                        onClick={() => seekForward(15)}
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 8,
                          color: "rgba(255,255,255,0.55)",
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "4px 6px",
                          flexShrink: 0,
                        }}
                      >
                        +15
                      </button>
                    </>
                  ) : null}
                  <span onClick={(e) => e.stopPropagation()}>
                    <MusicPlusButton
                      track={plusTrack}
                      userId={userId}
                      access={trackAccess}
                      onLibraryChange={onLibraryChange}
                    />
                  </span>
                  {previewUnavailable || rowPlayState.disabled ? (
                    <span
                      style={{
                        fontSize: 9,
                        color: "rgba(255,255,255,0.4)",
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                        flexShrink: 0,
                        maxWidth: 72,
                        textAlign: "right",
                        lineHeight: 1.2,
                      }}
                    >
                      {rowPlayState.label === "Play" ? "Preview not available" : rowPlayState.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={
                        active && isPlaying
                          ? `Pause ${track.title}`
                          : rowPlayState.disabled
                            ? rowPlayState.label
                            : `Play ${track.title}`
                      }
                      disabled={rowPlayState.disabled}
                      onClick={() => {
                        if (active) {
                          void toggle();
                          return;
                        }
                        playTrackInSheet(index);
                      }}
                      style={{
                        width: isMobile ? 40 : 32,
                        height: isMobile ? 40 : 32,
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "rgba(255,255,255,0.05)",
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
                      {active && isPlaying ? "⏸" : "▶"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {error && tracks.some((t) => isSamePlaybackTrack(currentTrack, t)) && (
            <div
              style={{
                padding: "10px 16px",
                background: "rgba(255,60,60,0.1)",
                borderTop: "1px solid rgba(255,60,60,0.18)",
                fontSize: 12,
                color: "rgba(255,160,160,0.9)",
                flexShrink: 0,
                textAlign: "center",
                letterSpacing: 0.2,
              }}
            >
              Can&apos;t play this right now. Try another track.
            </div>
          )}

          <div style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", flexShrink: 0 }} />
        </div>
      </motion.div>
    </div>
    </ModalErrorBoundary>
  );
}
