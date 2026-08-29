"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePlaybackIdentity } from "@/context/AudioContext";
import { getPagePlaybackActionsBridge, queuePlayIntent } from "@/lib/playback/page-playback-actions-bridge";
import { toPlaybackTrack, toInstantStartTrack } from "@/lib/music-playback";
import { resolveTrackAccess } from "@/lib/music-access";
import { getPlaybackPrewarmEntry, playbackPrewarmKeyForItem } from "@/lib/playback/playback-prewarm-cache";
import { preloadTrack } from "@/media/preloader/MediaPreloader";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import MusicPlusButton from "@/components/music/MusicPlusButton";

export default function ReleaseCardPlayButton({ item, accountState, userId, isAdmin = false, source = "home_card", onPlayClick, available = true }) {
  const { currentTrackId, currentTrackSlug, isPlaying } = usePlaybackIdentity();
  const upgradeTimerRef = useRef(null);
  const lastTapRef = useRef(0);
  const hoverProbeTimerRef = useRef(null);

  const access = useMemo(
    () => resolveTrackAccess(item, { ...(accountState || {}), userId, isAdmin }),
    [accountState, item, userId, isAdmin]
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
    if (hoverProbeTimerRef.current) clearTimeout(hoverProbeTimerRef.current);
  }, []);

  const _hintTrack = useCallback(() => {
    const prewarmKey = playbackPrewarmKeyForItem(item);
    const prewarmed = prewarmKey ? getPlaybackPrewarmEntry(prewarmKey) : null;
    const playbackItem = prewarmed?.normalizedFirst || item;
    const track = toPlaybackTrack(playbackItem, { ...accountState, userId, isAdmin }, source);
    if (!track?.src) return;
    const { startTrack } = toInstantStartTrack(track);
    if (startTrack?.src) getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(startTrack);
  }, [accountState, item, source, userId, isAdmin]);

  // Desktop: 150 ms debounce — fires before the user's finger lifts off the mouse button.
  const handleMouseEnter = useCallback(() => {
    if (hoverProbeTimerRef.current) clearTimeout(hoverProbeTimerRef.current);
    hoverProbeTimerRef.current = setTimeout(_hintTrack, 150);
  }, [_hintTrack]);

  const handleMouseLeave = useCallback(() => {
    if (hoverProbeTimerRef.current) {
      clearTimeout(hoverProbeTimerRef.current);
      hoverProbeTimerRef.current = null;
    }
  }, []);

  // Mobile: touchstart fires before touchend/click — 100-300 ms head start on every tap.
  const handleTouchStart = useCallback(() => { _hintTrack(); }, [_hintTrack]);

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
      const prewarmKey = playbackPrewarmKeyForItem(item);
      const prewarmed = prewarmKey ? getPlaybackPrewarmEntry(prewarmKey) : null;
      const playbackItem = prewarmed?.normalizedFirst || item;
      const track = toPlaybackTrack(playbackItem, { ...accountState, userId, isAdmin }, source);
      if (!track.src) return;
      const sameTrack =
        currentTrackId &&
        (currentTrackSlug === track.slug || currentTrackId === track.id);
      if (sameTrack) {
        void getPagePlaybackActionsBridge()?.toggle?.();
        return;
      }
      if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
      const { startTrack, needsUpgrade } = toInstantStartTrack(track);
      queuePlayIntent((bridge) => void bridge.playQueue?.([startTrack], 0, { resumeAt: 0 }));
      const needsPreviewUpgrade =
        needsUpgrade ||
        (track.metadata?.access?.canStream && track.metadata?.access?.previewOnly);
      if (needsPreviewUpgrade) {
        const upgradeSlug = track.slug;
        upgradeTimerRef.current = setTimeout(() => {
          const b = getPagePlaybackActionsBridge();
          if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
        }, 2000);
      }
    },
    [accountState, isAdmin, currentTrackId, currentTrackSlug, item, onPlayClick, source, userId]
  );

  const sameTrack = currentTrackId && currentTrackSlug === item?.slug;
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
      aria-hidden={!available}
      disabled={!available}
      data-release-action="playback"
      data-playback-state={showPause ? "pause" : "play"}
      onClick={handlePlay}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
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
        visibility: available ? "visible" : "hidden",
        pointerEvents: available ? "auto" : "none",
      }}
    >
      <span style={{ position: "relative", width: 14, height: 14, display: "block" }}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          data-release-action-icon="pause"
          style={{ position: "absolute", inset: 0, opacity: showPause ? 1 : 0 }}
        >
          <rect x="2" y="1.5" width="3.5" height="11" rx="1.2" fill="#00ffff" />
          <rect x="8.5" y="1.5" width="3.5" height="11" rx="1.2" fill="#00ffff" />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          data-release-action-icon="play"
          style={{ position: "absolute", inset: 0, marginLeft: 2, opacity: showPause ? 0 : 1 }}
        >
          <path d="M3 1.5L13 7L3 12.5V1.5Z" fill="#00ffff" />
        </svg>
      </span>
    </button>
  );
}

export function ReleaseCardActions({
  item,
  accountState,
  userId,
  isAdmin = false,
  source,
  onAddToCart,
  onPlayClick,
  onLibraryChange,
  cartButtonStyle,
  cartLabel = "+ Cart",
  showCart = true,
  showPlay = true,
}) {
  const access = useMemo(
    () => resolveTrackAccess(item, { ...(accountState || {}), userId, isAdmin }),
    [accountState, item, userId, isAdmin]
  );

  return (
    <div
      data-persistent-release-actions="true"
      style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}
    >
      <span data-release-action-slot="playback" style={{ display: "inline-flex", flexShrink: 0 }}>
        <ReleaseCardPlayButton item={item} accountState={accountState} userId={userId} isAdmin={isAdmin} source={source} onPlayClick={onPlayClick} available={showPlay} />
      </span>
      <span
        data-release-action-slot="library"
        aria-hidden={!showPlay}
        onClick={(e) => e.stopPropagation()}
        style={{ display: "inline-flex", flexShrink: 0, visibility: showPlay ? "visible" : "hidden", pointerEvents: showPlay ? "auto" : "none" }}
      >
        <MusicPlusButton track={item} userId={userId} access={access} onLibraryChange={onLibraryChange} />
      </span>
      <button
        type="button"
        aria-hidden={!showCart}
        disabled={!showCart}
        data-release-action-slot="purchase"
        onClick={onAddToCart}
        style={{
          flex: 1,
          height: 44,
          padding: "7px 0",
          fontSize: 11,
          fontWeight: 600,
          cursor: showCart ? "pointer" : "default",
          borderRadius: 7,
          transition: "0.2s",
          visibility: showCart ? "visible" : "hidden",
          pointerEvents: showCart ? "auto" : "none",
          ...cartButtonStyle,
        }}
      >
        {cartLabel}
      </button>
    </div>
  );
}
