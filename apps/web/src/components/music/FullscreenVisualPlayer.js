"use client";

/**
 * FullscreenVisualPlayer — OWNER of fullscreen visual playback surface.
 *
 * EXPLICIT USER ACTION ONLY — never auto-opened.
 * Receives control when the user deliberately triggers fullscreen mode.
 *
 * Desktop: requests Browser Fullscreen API on the container element.
 * Mobile: position:fixed with inset:0 (maximum display area; iOS Safari
 *         does not support requestFullscreen on arbitrary elements).
 *
 * Audio: does NOT manage audio. PlaybackStateMachine continues as sole audio authority.
 * Video: plays the track's HLS video feed via a <video> element.
 * State: calls interactiveMediaState.enterFullscreen / exitFullscreen on lifecycle.
 *
 * Props:
 *   videoUrl    {string}   — HLS or direct video URL for this track
 *   artworkUrl  {string}   — fallback artwork image
 *   trackTitle  {string?}  — displayed in overlay
 *   artistName  {string?}
 *   onClose     {fn}       — called when user dismisses
 */

import { useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { interactiveMediaState } from "@/media/InteractiveMediaState";
import { logVisualFullOpened, logVisualFullClosed } from "@/lib/media/visual-telemetry";

export function FullscreenVisualPlayer({
  videoUrl,
  artworkUrl,
  trackTitle   = "",
  artistName   = "",
  onClose,
}) {
  const containerRef = useRef(null);
  const videoRef     = useRef(null);
  const isMobile     = useRef(
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    interactiveMediaState.enterFullscreen();
    logVisualFullOpened({ trackTitle, artistName });

    // Request browser fullscreen on desktop
    if (!isMobile.current && containerRef.current) {
      const el = containerRef.current;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      if (req) {
        try { req.call(el); } catch {}
      }
    }

    // Auto-play video
    const vid = videoRef.current;
    if (vid) vid.play().catch(() => {});

    return () => {
      interactiveMediaState.exitFullscreen();
      logVisualFullClosed({ trackTitle, artistName });

      // Exit browser fullscreen if we entered it
      if (!isMobile.current && document.fullscreenElement) {
        try {
          (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen)
            ?.call(document);
        } catch {}
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss on browser fullscreen exit (e.g., user presses Esc)
  useEffect(() => {
    function onFSChange() {
      if (!document.fullscreenElement) {
        onClose?.();
      }
    }
    document.addEventListener("fullscreenchange",       onFSChange);
    document.addEventListener("webkitfullscreenchange", onFSChange);
    return () => {
      document.removeEventListener("fullscreenchange",       onFSChange);
      document.removeEventListener("webkitfullscreenchange", onFSChange);
    };
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleClose = useCallback(() => onClose?.(), [onClose]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      style={{
        position:        "fixed",
        inset:           0,
        zIndex:          9999,
        background:      "#000",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        flexDirection:   "column",
      }}
      aria-label="Fullscreen Visual Player"
      role="dialog"
      aria-modal="true"
    >
      {/* Video */}
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          loop
          autoPlay
          style={{
            position:   "absolute",
            inset:      0,
            width:      "100%",
            height:     "100%",
            objectFit:  "contain",
          }}
        />
      ) : artworkUrl ? (
        <Image
          src={artworkUrl}
          alt={trackTitle || "Artwork"}
          fill
          style={{ objectFit: "contain" }}
          priority
        />
      ) : null}

      {/* Info overlay (bottom) */}
      <div
        style={{
          position:   "absolute",
          bottom:     0,
          left:       0,
          right:      0,
          padding:    "24px 20px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
          color:      "#fff",
          pointerEvents: "none",
        }}
      >
        {artistName && (
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4, fontWeight: 500 }}>
            {artistName}
          </div>
        )}
        {trackTitle && (
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {trackTitle}
          </div>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={handleClose}
        aria-label="Close fullscreen"
        style={{
          position:        "absolute",
          top:             16,
          right:           16,
          background:      "rgba(0,0,0,0.5)",
          border:          "none",
          borderRadius:    "50%",
          width:           40,
          height:          40,
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          cursor:          "pointer",
          color:           "#fff",
          fontSize:        20,
          zIndex:          1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

export default FullscreenVisualPlayer;
