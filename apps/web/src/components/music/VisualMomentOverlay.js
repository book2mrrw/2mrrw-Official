"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { VRM } from "@/lib/media/video-resource-manager";
import { globalMediaController } from "@/media/visualEngine/GlobalMediaController";
import { logVisualVideoError } from "@/lib/media/visual-telemetry";

/**
 * VisualMomentOverlay
 *
 * Renders inside a release card. When `active` is true the overlay fades in
 * over the cover art and plays the visual asset (MP4 or WebM loop).
 *
 * The outer card is expected to scale slightly via CSS while the moment is active
 * (controlled by the parent via className/style). This component handles only
 * the video element lifecycle and the fade animation.
 *
 * For synced visuals the parent calls syncVideoToAudio() after mount.
 * For independent visuals the GlobalMediaController has already paused background audio.
 *
 * Props:
 *   active        — boolean, true = moment is active
 *   asset         — release_visual_assets row (with resolved_url, poster_url)
 *   releaseSlug   — string
 *   onSwipeUp     — called when the user swipes up during hold (triggers FullVisualExperience)
 *   onVideoError  — called if video fails (parent falls back to static cover)
 */
function VisualMomentOverlay({ active, asset, releaseSlug, onSwipeUp, onVideoError }) {
  const videoRef   = useRef(null);
  const rafRef     = useRef(null);
  const [opacity, setOpacity] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);

  const src       = asset?.resolved_url || asset?.r2_key_url || null;
  const poster    = asset?.poster_url   || asset?.thumbnail_url || null;
  const isSync    = (asset?.playback_mode ?? "synced") === "synced";
  const syncOffset = Number(asset?.sync_offset ?? 0);

  // ── Fade in/out via rAF-animated opacity ──────────────────────────────────
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const targetOpacity = active ? 1 : 0;
    const duration      = active ? 280 : 200; // ms
    let start   = null;
    const from  = active ? 0 : 1;
    const delta = targetOpacity - from;

    function step(ts) {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      // ease-out cubic
      const eased = active
        ? 1 - Math.pow(1 - progress, 3)
        : 1 - Math.pow(progress, 2);
      setOpacity(from + delta * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active]);

  // ── Video lifecycle ────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el || !src || !active) return;
    if (el.getAttribute("data-src") !== src) {
      el.setAttribute("data-src", src);
      el.src = src;
      el.preload = "auto";
      el.load();
    }
  }, [active, src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    VRM.register(el, VRM.PRIORITY_HERO);

    if (active && src && !videoFailed) {
      if (isSync) {
        // Sync to current audio position before starting
        globalMediaController.syncVideoToAudio(el, syncOffset);
        el.muted = true;
      } else {
        // Independent: video has its own audio, keep its timeline
        el.muted = false;
        el.currentTime = 0;
      }
      VRM.requestPlay(
        el,
        () => el.play().catch(() => {}),
        () => { if (!el.paused) el.pause(); }
      );
    } else {
      VRM.requestPause(el);
      if (!el.paused) el.pause();
    }

    return () => {};
  }, [active, src, videoFailed, isSync, syncOffset]);

  // Sync drift correction while active (synced mode only)
  useEffect(() => {
    if (!active || !isSync) return;
    const el = videoRef.current;
    if (!el) return;

    const interval = setInterval(() => {
      globalMediaController.syncVideoToAudio(el, syncOffset);
    }, 2000);

    return () => clearInterval(interval);
  }, [active, isSync, syncOffset]);

  // Cleanup VRM on unmount
  useEffect(() => {
    const el = videoRef.current;
    return () => {
      if (el) {
        VRM.requestPause(el);
        VRM.unregister(el);
      }
    };
  }, []);

  const handleError = useCallback(() => {
    setVideoFailed(true);
    logVisualVideoError({ src: src ?? "", context: "VisualMomentOverlay" });
    onVideoError?.();
  }, [src, onVideoError]);

  if (!src || videoFailed) return null;

  return (
    <div
      aria-hidden
      style={{
        position:      "absolute",
        inset:         0,
        opacity,
        pointerEvents: active ? "none" : "none",
        zIndex:        2,
        overflow:      "hidden",
        borderRadius:  "inherit",
      }}
    >
      <video
        ref={videoRef}
        loop
        playsInline
        preload="none"
        poster={poster || undefined}
        onError={handleError}
        webkit-playsinline="true"
        style={{
          width:      "100%",
          height:     "100%",
          objectFit:  "cover",
          display:    "block",
        }}
      />
    </div>
  );
}

export default memo(VisualMomentOverlay);
