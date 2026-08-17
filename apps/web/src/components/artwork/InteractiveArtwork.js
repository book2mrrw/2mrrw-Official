"use client";

/**
 * InteractiveArtwork — OWNER of all visual artwork interaction rendering.
 *
 * Universal drop-in for every surface: CatalogGrid, GlobalAudioPlayerBar,
 * FloatingMainPlayer, tracklist thumbnails, search results, My Music, My Collection.
 *
 * Wires together:
 *   useArtworkGesture  → Slow/Chop/Filter gesture recognition
 *   useVideoWake       → In-card video wake (inside card bounds ONLY)
 *   InteractiveMediaState → visual feedback state
 *   ScrewEngine / ChopEngine / FilterEngine → imported to boot them (self-register with IMS)
 *
 * ABSOLUTE RULE: No modal is ever opened automatically.
 *   onVideoModalRequest is called ONLY on explicit user tap while VIDEO_WOKEN.
 *
 * Props:
 *   slug              {string}   — release slug (gestureOwner identity)
 *   trackId           {string}   — for video wake track change detection
 *   imageUrl          {string}   — artwork image URL
 *   videoUrl          {string?}  — in-card video URL (null if no video asset)
 *   hasVideoAsset     {boolean}  — whether this track has a video asset
 *   size              {number?}  — width/height in px (default: CSS-driven)
 *   className         {string?}
 *   style             {object?}
 *   onVideoModalRequest {fn?}    — called on explicit tap while VIDEO_WOKEN
 *   interactive       {boolean}  — false disables all gestures (default true)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useArtworkGesture } from "@/hooks/useArtworkGesture";
import { useVideoWake }      from "@/hooks/useVideoWake";
import { interactiveMediaState, PLAYBACK_MODE, PERFORMANCE_EFFECT, VIDEO_STATE } from "@/media/InteractiveMediaState";

// Boot effect engines — module import triggers their self-registration with IMS.
// Safe: this is a "use client" module; Next.js never SSR-executes it.
import "@/media/effects/ScrewEngine";
import "@/media/effects/ChopEngine";
import "@/media/effects/FilterEngine";

// ── Visual constants ──────────────────────────────────────────────────────────

const DOT_STYLE_BASE = {
  position: "absolute",
  bottom: 6,
  right: 6,
  width: 8,
  height: 8,
  borderRadius: "50%",
  transition: "opacity 120ms, background 120ms",
  pointerEvents: "none",
  zIndex: 10,
};

const DOT_NORMAL    = { ...DOT_STYLE_BASE, opacity: 0 };
const DOT_MOMENTARY = { ...DOT_STYLE_BASE, opacity: 1, background: "#FFAE00" };
const DOT_LOCKED    = { ...DOT_STYLE_BASE, opacity: 1, background: "#FF3B30" };

function _getDotStyle(mode) {
  if (mode === PLAYBACK_MODE.SLOW_LOCKED)    return DOT_LOCKED;
  if (mode === PLAYBACK_MODE.SLOW_MOMENTARY) return DOT_MOMENTARY;
  return DOT_NORMAL;
}

const BORDER_NORMAL = "transparent";
const BORDER_CHOP   = "#FF6B00";
const BORDER_FILTER = "#0A84FF";

function _getBorderColor(effect) {
  if (effect === PERFORMANCE_EFFECT.CHOP)   return BORDER_CHOP;
  if (effect === PERFORMANCE_EFFECT.FILTER) return BORDER_FILTER;
  return BORDER_NORMAL;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InteractiveArtwork({
  slug,
  trackId,
  imageUrl,
  videoUrl        = null,
  hasVideoAsset   = false,
  size,
  className       = "",
  style           = {},
  onVideoModalRequest = null,
  interactive     = true,
}) {
  const elementRef = useRef(null);
  const videoRef   = useRef(null);

  // IMS snapshot subscription for visual feedback
  const [imsSnap, setImsSnap] = useState(() => interactiveMediaState.getSnapshot());
  useEffect(() => {
    return interactiveMediaState.subscribe(setImsSnap);
  }, []);

  // Gesture recognition
  const { handlers } = useArtworkGesture({
    slug,
    elementRef,
    disabled: !interactive,
  });

  // Video wake eligibility + dwell timing
  const { videoState } = useVideoWake({
    elementRef,
    hasVideoAsset,
    trackId,
    slug,
  });

  // Autoplay in-card video when woken
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (videoState === VIDEO_STATE.VIDEO_WOKEN) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
      vid.currentTime = 0;
    }
  }, [videoState]);

  // Explicit tap to request modal (only when already woken)
  const handleTap = useCallback((e) => {
    if (videoState === VIDEO_STATE.VIDEO_WOKEN && onVideoModalRequest) {
      e.stopPropagation();
      onVideoModalRequest();
    }
  }, [videoState, onVideoModalRequest]);

  const showVideo   = videoState === VIDEO_STATE.VIDEO_WOKEN && videoUrl;
  const dotStyle    = _getDotStyle(imsSnap.playbackMode);
  const borderColor = _getBorderColor(imsSnap.performanceEffect);

  const sizeStyle = size ? { width: size, height: size } : {};

  const containerStyle = {
    position: "relative",
    overflow: "hidden",
    flexShrink: 0,
    cursor: interactive ? "pointer" : undefined,
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "pan-y",
    outline: `2px solid ${borderColor}`,
    outlineOffset: -2,
    transition: "outline-color 80ms",
    ...sizeStyle,
    ...style,
  };

  return (
    <div
      ref={elementRef}
      className={className}
      style={containerStyle}
      {...(interactive ? handlers : {})}
      onClick={handleTap}
    >
      {/* Artwork image — always rendered; video overlays on wake */}
      {imageUrl && (
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes={size ? `${size}px` : "100vw"}
          style={{ objectFit: "cover", transition: "opacity 200ms" }}
          draggable={false}
          priority={false}
        />
      )}

      {/* In-card video — inside card bounds ONLY, never modal */}
      {hasVideoAsset && videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          loop
          preload="metadata"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: showVideo ? 1 : 0,
            transition: "opacity 400ms",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Slow/Screw mode indicator dot */}
      {interactive && <div style={dotStyle} aria-hidden="true" />}
    </div>
  );
}

export default InteractiveArtwork;
