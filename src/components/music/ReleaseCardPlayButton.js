"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { toPlaybackTrack } from "@/lib/music-playback";
import { resolveTrackAccess } from "@/lib/music-access";
import { preloadTrack } from "@/media/preloader/MediaPreloader";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";

export default function ReleaseCardPlayButton({ item, accountState, userId, source = "home_card", onPlayClick }) {
  const { playQueue, toggle, currentTrack, isPlaying, hasStarted, upgradeToFullStream } = useAudioPlayer();
  const upgradeTimerRef = useRef(null);

  const access = useMemo(
    () => resolveTrackAccess(item, { ...accountState, userId }),
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
      if (onPlayClick) {
        onPlayClick(e, item);
        return;
      }
      const track = toPlaybackTrack(item, { ...accountState, userId }, source);
      if (!track.src) return;
      const sameTrack =
        hasStarted &&
        (currentTrack?.slug === track.slug || currentTrack?.id === track.id);
      if (sameTrack) {
        void toggle();
        return;
      }
      if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
      void playQueue([track], 0);
      if (track.metadata?.access?.canStream) {
        upgradeTimerRef.current = setTimeout(() => {
          void upgradeToFullStream();
        }, 2000);
      }
    },
    [
      accountState,
      currentTrack?.id,
      currentTrack?.slug,
      hasStarted,
      item,
      onPlayClick,
      playQueue,
      source,
      toggle,
      upgradeToFullStream,
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
        background: "#111",
        border: "1px solid #333",
        borderRadius: 10,
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span style={{ color: "#00ffff", fontSize: 16, lineHeight: 1 }}>{showPause ? "⏸" : "▶"}</span>
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
  cartButtonStyle,
  cartLabel = "+ Cart",
  showCart = true,
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <ReleaseCardPlayButton item={item} accountState={accountState} userId={userId} source={source} onPlayClick={onPlayClick} />
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
