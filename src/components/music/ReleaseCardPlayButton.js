"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { toPlaybackTrack } from "@/lib/music-playback";
import { resolveTrackAccess } from "@/lib/music-access";
import { getPlaybackPrewarmEntry, playbackPrewarmKey } from "@/lib/playback/playback-prewarm-cache";
import { preloadTrack } from "@/media/preloader/MediaPreloader";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import MusicPlusButton from "@/components/music/MusicPlusButton";

export default function ReleaseCardPlayButton({ item, accountState, userId, source = "home_card", onPlayClick }) {
  const { dispatchPlaybackCommand, toggle, currentTrack, isPlaying, hasStarted } = useAudioPlayer();
  const upgradeTimerRef = useRef(null);
  const lastTapRef = useRef(0);

  const access = useMemo(
    () => resolveTrackAccess(item, { ...(accountState || {}), userId }),
    [accountState, item, userId]
  );

  useEffect(() => {
    const previewPath = item?.preview || item?.preview_path || item?.previewPath;
    const previewUrl = previewPath
      ? catalogPreviewAudioUrl(previewPath)
      : typeof item?.preview === "string" && item.preview.startsWith("http")
        ? item.preview
        : "";
    if (!previewUrl) return;
    const coverDisplay = catalogCoverDisplay(item);
    preloadTrack(item?.slug || item?.id, previewUrl, coverDisplay.src, coverDisplay.type);
  }, [item]);

  useEffect(() => () => {
    if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
  }, []);

  const handlePlay = useCallback(
    (e) => {
      e.stopPropagation();
      const now = Date.now();
      if (now - lastTapRef.current < 300) return;
      lastTapRef.current = now;
      if (onPlayClick) {
        onPlayClick(e, item);
        return;
      }
      const prewarmKey = playbackPrewarmKey({
        releaseSlug: item?.albumSlug || item?.slug,
        trackSlug: item?.trackSlug || item?.track_slug,
        trackIndex: item?.trackIndex ?? 0,
      });
      const prewarmed = getPlaybackPrewarmEntry(prewarmKey);
      const playbackItem = prewarmed?.normalizedFirst || item;
      const track = toPlaybackTrack(playbackItem, { ...accountState, userId }, source);
      if (!track.src) return;
      const sameTrack =
        hasStarted &&
        (currentTrack?.slug === track.slug || currentTrack?.id === track.id);
      if (sameTrack) {
        void toggle();
        return;
      }
      if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
      void dispatchPlaybackCommand("playQueue", { tracks: [track], startIndex: 0 });
      const needsPreviewUpgrade =
        track.metadata?.access?.canStream && track.metadata?.access?.previewOnly;
      if (needsPreviewUpgrade) {
        upgradeTimerRef.current = setTimeout(() => {
          void dispatchPlaybackCommand("upgradeStream");
        }, 2000);
      }
    },
    [
      accountState,
      currentTrack?.id,
      currentTrack?.slug,
      dispatchPlaybackCommand,
      hasStarted,
      item,
      onPlayClick,
      source,
      toggle,
      userId,
    ]
  );

  const sameTrack =
    hasStarted &&
    currentTrack &&
    (currentTrack.slug === item?.slug || currentTrack.id === item?.slug);
  const showPause = sameTrack && isPlaying;
  const playAriaLabel = showPause
    ? "Pause"
    : access?.canStream
      ? "Play full track"
      : "Play preview";

  return (
    <button
      type="button"
      aria-label={playAriaLabel}
      onClick={handlePlay}
      style={{
        width: 44,
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: showPause ? "rgba(0,255,255,0.1)" : "#111",
        border: `1px solid ${showPause ? "rgba(0,255,255,0.5)" : "#333"}`,
        borderRadius: 10,
        cursor: "pointer",
        padding: 0,
        boxShadow: showPause ? "0 0 10px rgba(0,255,255,0.2)" : "none",
        transition: "all 0.2s",
        touchAction: "manipulation",
      }}
    >
      <span
        style={{
          color: "#00ffff",
          fontSize: showPause ? 13 : 16,
          lineHeight: 1,
          letterSpacing: showPause ? 2 : 0,
        }}
      >
        {showPause ? "❙❙" : "▶"}
      </span>
    </button>
  );
}

export function ReleaseCardActions({
  item,
  accountState,
  userId,
  source,
  onAddToCart,
  onPlayClick,
  onLibraryChange,
  cartButtonStyle,
  cartLabel = "+ Cart",
  showCart = true,
}) {
  const access = useMemo(
    () => resolveTrackAccess(item, { ...(accountState || {}), userId }),
    [accountState, item, userId]
  );

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <ReleaseCardPlayButton item={item} accountState={accountState} userId={userId} source={source} onPlayClick={onPlayClick} />
      <span onClick={(e) => e.stopPropagation()}>
        <MusicPlusButton track={item} userId={userId} access={access} onLibraryChange={onLibraryChange} />
      </span>
      {showCart ? (
        <button
          type="button"
          onClick={onAddToCart}
          style={{
            flex: 1,
            height: 44,
            padding: "7px 0",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            borderRadius: 7,
            transition: "0.2s",
            ...cartButtonStyle,
          }}
        >
          {cartLabel}
        </button>
      ) : null}
    </div>
  );
}
