"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { VRM } from "@/lib/media/video-resource-manager";
import { globalMediaController } from "@/media/visualEngine/GlobalMediaController";
import { logVisualVideoError, logVisualVideoFallback } from "@/lib/media/visual-telemetry";

/**
 * FullVisualExperience
 *
 * Full-screen overlay portal for Visual Moments that have expanded (hold + swipe up)
 * or for direct full-video experiences (music_video, interview, bts, performance, etc.).
 *
 * Architecture mirrors VaultVideoPlayer but:
 *   - No vault entitlement logic
 *   - Supports both direct MP4 (r2_key) and HLS (hls_slug)
 *   - For synced assets: video plays muted, synced to global audio via GlobalMediaController
 *   - For independent assets: video plays with its own audio (global audio was already paused)
 *
 * Keyboard shortcuts: Escape = close, Space = play/pause (independent mode only)
 *
 * Props:
 *   asset         — release_visual_assets row
 *   releaseSlug   — string
 *   coverUrl      — fallback poster image
 *   onClose       — called when the experience closes
 */
function FullVisualExperience({ asset, releaseSlug, coverUrl, onClose }) {
  const videoRef    = useRef(null);
  const hlsRef      = useRef(null);
  const syncRafRef  = useRef(null);

  const [isPlaying, setIsPlaying]   = useState(false);
  const [isLoading, setIsLoading]   = useState(true);
  const [hasError, setHasError]     = useState(false);
  const [showControls, setControls] = useState(true);
  const controlsTimerRef = useRef(null);

  const src        = asset?.resolved_url || asset?.r2_key_url || null;
  const poster     = asset?.poster_url   || asset?.thumbnail_url || coverUrl || null;
  const hlsSlug    = asset?.hls_slug;
  const isSync     = (asset?.playback_mode ?? "synced") === "synced";
  const syncOffset = Number(asset?.sync_offset ?? 0);

  // ── Register with VRM at PRIORITY_SYSTEM ──────────────────────────────────
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    VRM.register(el, VRM.PRIORITY_SYSTEM);
    return () => { VRM.unregister(el); };
  }, []);

  // ── Body scroll lock ───────────────────────────────────────────────────────
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Load video content ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    setIsLoading(true);
    setHasError(false);

    if (isSync) {
      el.muted = true;
      globalMediaController.syncVideoToAudio(el, syncOffset);
    } else {
      el.muted = false;
      el.currentTime = 0;
    }

    if (hlsSlug) {
      _loadHls(hlsSlug, el, setIsLoading, setHasError, hlsRef);
    } else if (src) {
      el.src = src;
      el.load();
      VRM.requestPlay(el,
        () => el.play().then(() => setIsPlaying(true)).catch(() => {}),
        () => { if (!el.paused) el.pause(); }
      );
    }
  }, [src, hlsSlug, isSync, syncOffset]);

  // ── Continuous sync correction for synced mode ────────────────────────────
  useEffect(() => {
    if (!isSync) return;
    const el = videoRef.current;
    if (!el) return;

    const id = setInterval(() => {
      globalMediaController.syncVideoToAudio(el, syncOffset);
    }, 2000);
    return () => clearInterval(id);
  }, [isSync, syncOffset]);

  const handleClose = useCallback(() => {
    const el = videoRef.current;
    if (el) { el.pause(); el.src = ""; }
    hlsRef.current?.destroy?.();
    hlsRef.current = null;
    globalMediaController.exitFull();
    onClose?.();
  }, [onClose]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); handleClose(); }
      if (e.key === " " && !isSync) {
        e.preventDefault();
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) { el.play().catch(() => {}); setIsPlaying(true); }
        else { el.pause(); setIsPlaying(false); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, isSync]);

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  function _resetControlsTimer() {
    setControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setControls(false), 3000);
  }

  useEffect(() => {
    _resetControlsTimer();
    return () => clearTimeout(controlsTimerRef.current);
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const el = videoRef.current;
      if (el) { el.pause(); el.src = ""; }
      hlsRef.current?.destroy?.();
      clearInterval(syncRafRef.current);
      clearTimeout(controlsTimerRef.current);
    };
  }, []);

  const handleVideoPlay  = () => setIsPlaying(true);
  const handleVideoPause = () => setIsPlaying(false);
  const handleCanPlay    = () => setIsLoading(false);
  const handleVideoError = () => {
    setHasError(true);
    setIsLoading(false);
    logVisualVideoError({ src: src ?? hlsSlug ?? "", context: "FullVisualExperience" });
    if (src) logVisualVideoFallback({ src, context: "FullVisualExperience" });
  };

  const content = (
    <div
      style={styles.overlay}
      onPointerMove={_resetControlsTimer}
      onClick={_resetControlsTimer}
    >
      {/* Background poster while loading */}
      {poster && isLoading && (
        <div style={{ ...styles.posterBg, backgroundImage: `url(${poster})` }} />
      )}

      <video
        ref={videoRef}
        playsInline
        webkit-playsinline="true"
        poster={poster || undefined}
        onPlay={handleVideoPlay}
        onPause={handleVideoPause}
        onCanPlay={handleCanPlay}
        onError={handleVideoError}
        style={styles.video}
      />

      {/* Loading state */}
      {isLoading && !hasError && (
        <div style={styles.spinnerWrap}>
          <div style={styles.spinner} />
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div style={styles.errorWrap}>
          <div style={styles.errorText}>Visual unavailable</div>
        </div>
      )}

      {/* Controls overlay */}
      <div style={{ ...styles.controls, opacity: showControls ? 1 : 0 }}>
        {/* Close button */}
        <button
          onClick={handleClose}
          aria-label="Close visual experience"
          style={styles.closeBtn}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Bottom meta */}
        <div style={styles.meta}>
          {asset?.title && (
            <div style={styles.assetTitle}>{asset.title}</div>
          )}
          {isSync && (
            <div style={styles.syncBadge}>SYNCED TO AUDIO</div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

// ── HLS loading helper ─────────────────────────────────────────────────────────
async function _loadHls(hlsSlug, videoEl, setLoading, setError, hlsRef) {
  try {
    const { HLSVideoEngine } = await import("@/lib/hls/HLSVideoEngine");
    const engine = new HLSVideoEngine({
      onFallback: () => { videoEl.src = ""; setError(true); },
      onError:    () => setError(true),
    });
    hlsRef.current = engine;
    // For release visual HLS, the manifest URL goes through the same audio key route
    // but with a visual-assets token. For now fall back to placeholder if slug provided.
    const manifestUrl = `/api/media/visual-assets/hls/${encodeURIComponent(hlsSlug)}/manifest`;
    await engine.loadContent(manifestUrl, videoEl, {});
    setLoading(false);
  } catch {
    setError(true);
    setLoading(false);
  }
}

const styles = {
  overlay: {
    position:        "fixed",
    inset:           0,
    zIndex:          9999,
    background:      "#000",
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
  },
  posterBg: {
    position:           "absolute",
    inset:              0,
    backgroundSize:     "cover",
    backgroundPosition: "center",
    filter:             "blur(20px) brightness(0.3)",
    transform:          "scale(1.1)",
  },
  video: {
    position:   "absolute",
    inset:      0,
    width:      "100%",
    height:     "100%",
    objectFit:  "contain",
  },
  spinnerWrap: {
    position:        "absolute",
    inset:           0,
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
  },
  spinner: {
    width:        36,
    height:       36,
    border:       "3px solid rgba(255,255,255,0.15)",
    borderTop:    "3px solid rgba(255,255,255,0.8)",
    borderRadius: "50%",
    animation:    "spin 0.7s linear infinite",
  },
  errorWrap: {
    position:        "absolute",
    inset:           0,
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
  },
  errorText: {
    color:     "rgba(255,255,255,0.5)",
    fontSize:  14,
    fontFamily: "system-ui,sans-serif",
  },
  controls: {
    position:   "absolute",
    inset:      0,
    transition: "opacity 0.3s",
    pointerEvents: "none",
  },
  closeBtn: {
    position:        "absolute",
    top:             16,
    right:           16,
    width:           44,
    height:          44,
    border:          "none",
    borderRadius:    "50%",
    background:      "rgba(0,0,0,0.5)",
    color:           "white",
    cursor:          "pointer",
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
    pointerEvents:   "auto",
    backdropFilter:  "blur(4px)",
  },
  meta: {
    position:  "absolute",
    bottom:    24,
    left:      20,
    right:     20,
  },
  assetTitle: {
    fontSize:   15,
    fontWeight: 600,
    color:      "white",
    fontFamily: "system-ui,sans-serif",
    marginBottom: 4,
    textShadow:   "0 1px 4px rgba(0,0,0,0.7)",
  },
  syncBadge: {
    fontSize:      9,
    fontWeight:    700,
    letterSpacing: "0.15em",
    color:         "rgba(0,191,255,0.8)",
    fontFamily:    "'DM Mono',monospace,system-ui",
  },
};

export default memo(FullVisualExperience);
