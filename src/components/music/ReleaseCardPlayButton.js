"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePlaybackIdentity } from "@/context/AudioContext";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import { toPlaybackTrack, toInstantStartTrack } from "@/lib/music-playback";
import { resolveTrackAccess } from "@/lib/music-access";
import { getPlaybackPrewarmEntry, playbackPrewarmKeyForItem } from "@/lib/playback/playback-prewarm-cache";
import { preloadTrack } from "@/media/preloader/MediaPreloader";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import MusicPlusButton from "@/components/music/MusicPlusButton";

export default function ReleaseCardPlayButton({ item, accountState, userId, source = "home_card", onPlayClick }) {
  const { currentTrackId, currentTrackSlug, isPlaying } = usePlaybackIdentity();
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
      const bridge = getPagePlaybackActionsBridge();
      const prewarmKey = playbackPrewarmKeyForItem(item);
      const prewarmed = prewarmKey ? getPlaybackPrewarmEntry(prewarmKey) : null;
      const playbackItem = prewarmed?.normalizedFirst || item;
      const track = toPlaybackTrack(playbackItem, { ...accountState, userId }, source);
      if (!track.src) return;
      const sameTrack =
        currentTrackId &&
        (currentTrackSlug === track.slug || currentTrackId === track.id);
      if (sameTrack) {
        void bridge?.toggle?.();
        return;
      }
      if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
      const { startTrack, needsUpgrade } = toInstantStartTrack(track);
      void bridge?.playQueue?.([startTrack], 0);
      const needsPreviewUpgrade =
        needsUpgrade ||
        (track.metadata?.access?.canStream && track.metadata?.access?.previewOnly);
      if (needsPreviewUpgrade) {
        upgradeTimerRef.current = setTimeout(() => {
          void bridge?.dispatchPlaybackCommand?.("upgradeStream");
        }, 2000);
      }
    },
    [accountState, currentTrackId, currentTrackSlug, item, onPlayClick, source, userId]
  );

  const sameTrack =
    currentTrackId &&
    (currentTrackSlug === item?.slug || currentTrackId === item?.slug);
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
        background: showPause ? "rgba(0,255,255,0.1)" : "#0a0a0a",
        border: `1px solid ${showPause ? "rgba(0,255,255,0.7)" : "rgba(0,255,255,0.35)"}`,
        borderRadius: 10,
        cursor: "pointer",
        padding: 0,
        boxShadow: showPause
          ? "0 0 16px rgba(0,255,255,0.55), 0 0 6px rgba(0,255,255,0.25)"
          : "0 0 8px rgba(0,255,255,0.18), 0 0 2px rgba(0,255,255,0.08)",
        transition: "all 0.2s",
        touchAction: "manipulation",
      }}
    >
      {showPause ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect x="2" y="1.5" width="3.5" height="11" rx="1.2" fill="#00ffff" />
          <rect x="8.5" y="1.5" width="3.5" height="11" rx="1.2" fill="#00ffff" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden style={{ marginLeft: 2 }}>
          <path d="M3 1.5L13 7L3 12.5V1.5Z" fill="#00ffff" />
        </svg>
      )}
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
