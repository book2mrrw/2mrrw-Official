"use client";

/**
 * Audio Visualz video player — a real, working HLS+AES-128 player against
 * this feature's own manifest/key routes (never Vault's routes; a fully
 * separate component). Deliberately uses native browser <video controls>
 * rather than a custom seek bar/volume/fullscreen chrome — VaultVideoPlayer
 * (763 lines) is that fuller build; this is a scoped-down v1 that reuses
 * the same generic engines it does (HLSVideoEngine, VRM, FullVideoAuthority
 * — all confirmed manifest-URL-agnostic, no Vault-specific coupling), which
 * is what makes real HLS/DRM playback possible here without rebuilding all
 * of that from scratch. A custom-chrome upgrade is a clean later addition,
 * not a rewrite, since the engine wiring below wouldn't change.
 */
import { useEffect, useRef, useState } from "react";
import { HLSVideoEngine } from "@/lib/hls/HLSVideoEngine";
import { VRM } from "@/lib/media/video-resource-manager";
import { FullVideoAuthority } from "@/lib/media/full-video-authority";

export function AudioVisualPlayer({ videoId, title, posterUrl, onClose }) {
  const videoRef = useRef(null);
  const engineRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isPeekMode, setIsPeekMode] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoId) return;
    let mounted = true;
    let engine = null;
    let sessionId = null;

    VRM.register(el, VRM.PRIORITY_SYSTEM);

    const onPlaying = () => { if (mounted) setIsLoading(false); };
    const onWaiting = () => { if (mounted) setIsLoading(true); };
    const onError = () => { if (mounted) { setHasError(true); setIsLoading(false); } };
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("error", onError);

    const manifestUrl = `/api/audio-visual/${encodeURIComponent(videoId)}/manifest`;

    // Non-entitled callers get a 403 from /manifest (userCanWatchAudioVisual's
    // `full` gate — unchanged). Pre-flight it before touching the HLS engine
    // at all, so a non-buyer falls through to the always-allowed Peek clip
    // instead of hitting a hard HLS load error.
    const playFull = () => {
      const hlsEngine = new HLSVideoEngine();
      engine = hlsEngine;
      engineRef.current = hlsEngine;
      sessionId = `audio-visual:${videoId}`;
      FullVideoAuthority.requestFullVideoSession(sessionId, {
        onRevoked: () => { if (!el.paused) el.pause(); },
      });

      hlsEngine.onFallback = () => {
        // No progressive-download fallback for Audio Visualz — every real
        // rendition is AES-128 encrypted HLS by design (see packaging.js);
        // there is no unencrypted flat file to fall back to.
        if (mounted) {
          setHasError(true);
          setErrorMessage("This video isn't available for playback yet.");
          setIsLoading(false);
        }
      };
      hlsEngine.onError = (err) => {
        console.error("[AudioVisualPlayer] HLS error", err);
        if (mounted) { setHasError(true); setIsLoading(false); }
      };
      hlsEngine.onSegmentFatalError = () => {
        if (mounted) { setHasError(true); setIsLoading(false); }
      };

      hlsEngine.loadContent(manifestUrl, el, {})
        .then((hlsLoaded) => {
          if (!mounted || !hlsLoaded) return;
          VRM.requestPlay(el, () => el.play().catch(() => {}), () => { if (!el.paused) el.pause(); });
        })
        .catch((err) => {
          console.error("[AudioVisualPlayer] loadContent threw", err);
          if (mounted) { setHasError(true); setIsLoading(false); }
        });
    };

    const playPeek = async () => {
      if (mounted) setIsPeekMode(true);
      try {
        const res = await fetch(`/api/audio-visual/${encodeURIComponent(videoId)}/peek`);
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (!res.ok || !data.peek_url) {
          setErrorMessage("A preview isn't available for this video yet.");
          setHasError(true);
          setIsLoading(false);
          return;
        }
        el.src = data.peek_url;
        el.muted = false;
        VRM.requestPlay(el, () => el.play().catch(() => {}), () => { if (!el.paused) el.pause(); });
      } catch (err) {
        console.error("[AudioVisualPlayer] peek fetch threw", err);
        if (mounted) { setHasError(true); setIsLoading(false); }
      }
    };

    fetch(manifestUrl)
      .then((res) => {
        if (!mounted) return;
        if (res.status === 403) return playPeek();
        return playFull();
      })
      .catch((err) => {
        console.error("[AudioVisualPlayer] manifest pre-check threw", err);
        if (mounted) { setHasError(true); setIsLoading(false); }
      });

    return () => {
      mounted = false;
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("error", onError);
      if (sessionId) FullVideoAuthority.releaseFullVideoSession(sessionId);
      if (engine) engine.destroy();
      engineRef.current = null;
      VRM.unregister(el);
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [videoId]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" }}>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{title}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <video ref={videoRef} controls playsInline poster={posterUrl || undefined} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        {isLoading && !hasError && (
          <div style={{ position: "absolute", color: "#fff", fontSize: 13 }}>Loading…</div>
        )}
        {hasError && (
          <div style={{ position: "absolute", color: "#ff453a", fontSize: 13, textAlign: "center", maxWidth: 320 }}>
            {errorMessage || "Something went wrong loading this video."}
          </div>
        )}
        {isPeekMode && !hasError && (
          <div style={{ position: "absolute", bottom: 22, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none" }}>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>Preview</div>
            <a
              href="/subscribe"
              style={{
                pointerEvents: "auto",
                background: "#00ffff", color: "#000", fontWeight: 800, fontSize: 12,
                padding: "9px 20px", borderRadius: 999, textDecoration: "none",
              }}
            >
              Unlock the full video
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
