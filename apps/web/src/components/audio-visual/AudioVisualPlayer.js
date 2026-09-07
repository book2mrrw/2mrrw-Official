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

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoId) return;
    let mounted = true;

    VRM.register(el, VRM.PRIORITY_SYSTEM);

    const sessionId = `audio-visual:${videoId}`;
    FullVideoAuthority.requestFullVideoSession(sessionId, {
      onRevoked: () => { if (!el.paused) el.pause(); },
    });

    const onPlaying = () => { if (mounted) setIsLoading(false); };
    const onWaiting = () => { if (mounted) setIsLoading(true); };
    const onError = () => { if (mounted) { setHasError(true); setIsLoading(false); } };

    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("error", onError);

    const engine = new HLSVideoEngine();
    engineRef.current = engine;

    engine.onFallback = () => {
      // No progressive-download fallback for Audio Visualz — every real
      // rendition is AES-128 encrypted HLS by design (see packaging.js);
      // there is no unencrypted flat file to fall back to.
      if (mounted) {
        setHasError(true);
        setErrorMessage("This video isn't available for playback yet.");
        setIsLoading(false);
      }
    };
    engine.onError = (err) => {
      console.error("[AudioVisualPlayer] HLS error", err);
      if (mounted) { setHasError(true); setIsLoading(false); }
    };
    engine.onSegmentFatalError = () => {
      if (mounted) { setHasError(true); setIsLoading(false); }
    };

    const manifestUrl = `/api/audio-visual/${encodeURIComponent(videoId)}/manifest`;
    engine.loadContent(manifestUrl, el, {})
      .then((hlsLoaded) => {
        if (!mounted || !hlsLoaded) return;
        VRM.requestPlay(el, () => el.play().catch(() => {}), () => { if (!el.paused) el.pause(); });
      })
      .catch((err) => {
        console.error("[AudioVisualPlayer] loadContent threw", err);
        if (mounted) { setHasError(true); setIsLoading(false); }
      });

    return () => {
      mounted = false;
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("error", onError);
      FullVideoAuthority.releaseFullVideoSession(sessionId);
      engine.destroy();
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
      </div>
    </div>
  );
}
